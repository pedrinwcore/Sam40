const express = require('express');
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const SSHManager = require('../config/SSHManager');
const path = require('path');

const router = express.Router();

// Configurações de qualidade predefinidas
const qualityPresets = {
  baixa: { bitrate: 800, resolution: '854x480', crf: 28 },
  media: { bitrate: 1500, resolution: '1280x720', crf: 25 },
  alta: { bitrate: 2500, resolution: '1920x1080', crf: 23 },
  fullhd: { bitrate: 4000, resolution: '1920x1080', crf: 21 }
};

// GET /api/conversion/videos - Lista TODOS os vídeos (não apenas os que precisam conversão)
router.get('/videos', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const userLogin = req.user.email ? req.user.email.split('@')[0] : `user_${userId}`;
    const { folder_id } = req.query;

    let whereClause = 'WHERE codigo_cliente = ?';
    const params = [userId];

    if (folder_id) {
      // Buscar nome da pasta
      const [folderRows] = await db.execute(
        'SELECT identificacao FROM streamings WHERE codigo = ? AND codigo_cliente = ?',
        [folder_id, userId]
      );

      if (folderRows.length > 0) {
        const folderName = folderRows[0].identificacao;
        whereClause += ' AND pasta = ?';
        params.push(folderName);
      }
    }

    const [rows] = await db.execute(
      `SELECT 
        codigo as id,
        nome,
        caminho as url,
        duracao_segundos as duracao,
        tamanho_arquivo as tamanho,
        bitrate_video,
        formato_original,
        largura,
        altura,
        codec_video,
        is_mp4,
        compativel,
        motivos_incompatibilidade,
        data_upload
       FROM videos 
       ${whereClause}
       ORDER BY data_upload DESC`,
      params
    );

    // Processar TODOS os vídeos para mostrar opções de conversão
    const videos = rows.map(video => {
      const isMP4 = video.is_mp4 === 1;
      const currentBitrate = video.bitrate_video || 0;
      const userBitrateLimit = req.user.bitrate || 2500;
      const motivos = video.motivos_incompatibilidade ? 
        JSON.parse(video.motivos_incompatibilidade) : [];
      
      // Determinar quais qualidades estão disponíveis baseado no limite do usuário
      const availableQualities = [];
      Object.entries(qualityPresets).forEach(([quality, preset]) => {
        if (preset.bitrate <= userBitrateLimit) {
          availableQualities.push({
            quality,
            bitrate: preset.bitrate,
            resolution: preset.resolution,
            canConvert: true
          });
        } else {
          availableQualities.push({
            quality,
            bitrate: preset.bitrate,
            resolution: preset.resolution,
            canConvert: false,
            reason: `Excede limite do plano (${userBitrateLimit} kbps)`
          });
        }
      });
      
      return {
        ...video,
        motivos_incompatibilidade: motivos,
        is_mp4: isMP4,
        current_bitrate: currentBitrate,
        user_bitrate_limit: userBitrateLimit,
        available_qualities: availableQualities,
        can_use_current: video.compativel === 1,
        needs_conversion: video.compativel === 0,
        conversion_status: 'nao_iniciada'
      };
    });

    res.json({
      success: true,
      videos,
      user_limits: {
        bitrate: req.user.bitrate || 2500,
        storage: req.user.espaco || 1000
      },
      quality_presets: qualityPresets
    });
  } catch (error) {
    console.error('Erro ao listar vídeos para conversão:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao listar vídeos',
      details: error.message 
    });
  }
});

// POST /api/conversion/convert - Converter vídeo com qualidade selecionada
router.post('/convert', authMiddleware, async (req, res) => {
  try {
    const { video_id, quality, custom_bitrate, custom_resolution } = req.body;
    const userId = req.user.id;
    const userLogin = req.user.email ? req.user.email.split('@')[0] : `user_${userId}`;

    if (!video_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'ID do vídeo é obrigatório' 
      });
    }

    // Determinar configurações de conversão
    let conversionConfig;
    if (quality && qualityPresets[quality]) {
      conversionConfig = qualityPresets[quality];
    } else if (custom_bitrate && custom_resolution) {
      conversionConfig = {
        bitrate: custom_bitrate,
        resolution: custom_resolution,
        crf: 23 // CRF padrão para configurações customizadas
      };
    } else {
      return res.status(400).json({
        success: false,
        error: 'Especifique uma qualidade predefinida ou configurações customizadas'
      });
    }

    // Validar bitrate
    const maxBitrate = req.user.bitrate || 2500;
    if (conversionConfig.bitrate > maxBitrate) {
      return res.status(400).json({
        success: false,
        error: `Bitrate solicitado (${conversionConfig.bitrate} kbps) excede o limite do plano (${maxBitrate} kbps)`
      });
    }

    // Buscar vídeo
    const [videoRows] = await db.execute(
      'SELECT * FROM videos WHERE codigo = ? AND codigo_cliente = ?',
      [video_id, userId]
    );

    if (videoRows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Vídeo não encontrado' 
      });
    }

    const video = videoRows[0];

    // Buscar servidor do usuário
    const serverId = video.servidor_id || 1;

    // Construir caminhos
    const inputPath = `/usr/local/WowzaStreamingEngine/content/${video.caminho}`;
    const fileName = path.basename(inputPath);
    const directory = path.dirname(inputPath);
    const nameWithoutExt = path.parse(fileName).name;
    const qualitySuffix = quality ? `_${quality}` : `_${conversionConfig.bitrate}k`;
    const outputPath = path.join(directory, `${nameWithoutExt}${qualitySuffix}.mp4`);

    try {
      // Comando FFmpeg para conversão com qualidade específica
      const ffmpegCommand = `ffmpeg -i "${inputPath}" -c:v libx264 -preset medium -crf ${conversionConfig.crf} -b:v ${conversionConfig.bitrate}k -maxrate ${conversionConfig.bitrate}k -bufsize ${conversionConfig.bitrate * 2}k -vf "scale=${conversionConfig.resolution}" -c:a aac -b:a 128k -movflags +faststart "${outputPath}" -y 2>/dev/null && echo "CONVERSION_SUCCESS" || echo "CONVERSION_ERROR"`;
      
      console.log(`🔄 Iniciando conversão: ${fileName} -> ${quality || 'custom'} (${conversionConfig.bitrate} kbps)`);
      
      const result = await SSHManager.executeCommand(serverId, ffmpegCommand);
      
      if (result.stdout.includes('CONVERSION_SUCCESS')) {
        // Obter informações do arquivo convertido
        const sizeCommand = `stat -c%s "${outputPath}" 2>/dev/null || echo "0"`;
        const sizeResult = await SSHManager.executeCommand(serverId, sizeCommand);
        const newSize = parseInt(sizeResult.stdout.trim()) || 0;

        // Obter duração e bitrate real do arquivo convertido
        const probeCommand = `ffprobe -v quiet -print_format json -show_format -show_streams "${outputPath}" 2>/dev/null || echo "NO_PROBE"`;
        const probeResult = await SSHManager.executeCommand(serverId, probeCommand);
        
        let realBitrate = conversionConfig.bitrate;
        let realDuration = video.duracao_segundos || 0;
        
        if (!probeResult.stdout.includes('NO_PROBE')) {
          try {
            const probeData = JSON.parse(probeResult.stdout);
            if (probeData.format) {
              realDuration = Math.floor(parseFloat(probeData.format.duration) || 0);
              realBitrate = Math.floor(parseInt(probeData.format.bit_rate) / 1000) || conversionConfig.bitrate;
            }
          } catch (parseError) {
            console.warn('Erro ao parsear dados do ffprobe:', parseError);
          }
        }

        // Criar novo vídeo convertido na tabela videos
        const convertedFileName = `${nameWithoutExt}${qualitySuffix}.mp4`;
        const convertedPath = `${video.caminho.split('/').slice(0, -1).join('/')}/${convertedFileName}`;
        
        const [newVideoResult] = await db.execute(
          `INSERT INTO videos (
            codigo_cliente, nome, caminho, tamanho_arquivo, duracao_segundos,
            bitrate_video, formato_original, largura, altura, codec_video,
            is_mp4, compativel, motivos_incompatibilidade, pasta, servidor_id,
            video_original_id, qualidade_conversao, data_upload
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, '[]', ?, ?, ?, ?, NOW())`,
          [
            userId,
            convertedFileName,
            convertedPath,
            newSize,
            realDuration,
            realBitrate,
            'mp4',
            video.largura,
            video.altura,
            'h264',
            video.pasta,
            serverId,
            video_id,
            quality || 'custom'
          ]
        );

        console.log(`✅ Conversão concluída: ${fileName} -> ${quality || 'custom'} (${realBitrate} kbps)`);

        res.json({
          success: true,
          message: `Vídeo convertido com sucesso para qualidade ${quality || 'customizada'}!`,
          converted_video: {
            id: newVideoResult.insertId,
            path: outputPath,
            bitrate: realBitrate,
            duration: realDuration,
            quality: quality || 'custom'
          }
        });
      } else {
        throw new Error('Falha na conversão FFmpeg');
      }
    } catch (conversionError) {
      console.error('Erro na conversão:', conversionError);
      
      res.status(500).json({
        success: false,
        error: 'Erro na conversão do vídeo',
        details: conversionError.message
      });
    }
  } catch (error) {
    console.error('Erro ao converter vídeo:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor',
      details: error.message 
    });
  }
});

// GET /api/conversion/status/:video_id - Status da conversão
router.get('/status/:video_id', authMiddleware, async (req, res) => {
  try {
    const { video_id } = req.params;
    const userId = req.user.id;

    const [rows] = await db.execute(
      `SELECT 
        codigo as id,
        nome,
        bitrate_video,
        formato_original,
        compativel,
        qualidade_conversao,
        data_upload
       FROM videos 
       WHERE codigo = ? AND codigo_cliente = ?`,
      [video_id, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Vídeo não encontrado' 
      });
    }

    const video = rows[0];
    
    res.json({
      success: true,
      conversion_status: {
        id: video.id,
        nome: video.nome,
        status: video.compativel ? 'concluida' : 'nao_iniciada',
        bitrate: video.bitrate_video,
        converted_at: video.data_upload,
        original_format: video.formato_original
      }
    });
  } catch (error) {
    console.error('Erro ao verificar status da conversão:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao verificar status',
      details: error.message 
    });
  }
});

// GET /api/conversion/qualities - Obter qualidades disponíveis para o usuário
router.get('/qualities', authMiddleware, async (req, res) => {
  try {
    const userBitrateLimit = req.user.bitrate || 2500;
    
    const availableQualities = Object.entries(qualityPresets).map(([quality, preset]) => ({
      quality,
      label: quality.charAt(0).toUpperCase() + quality.slice(1),
      bitrate: preset.bitrate,
      resolution: preset.resolution,
      available: preset.bitrate <= userBitrateLimit,
      description: `${preset.resolution} @ ${preset.bitrate} kbps`
    }));

    res.json({
      success: true,
      qualities: availableQualities,
      user_limit: userBitrateLimit,
      custom_allowed: true
    });
  } catch (error) {
    console.error('Erro ao obter qualidades:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao obter qualidades disponíveis',
      details: error.message 
    });
  }
});

// DELETE /api/conversion/:video_id - Remover vídeo convertido
router.delete('/:video_id', authMiddleware, async (req, res) => {
  try {
    const { video_id } = req.params;
    const userId = req.user.id;

    // Buscar vídeo
    const [videoRows] = await db.execute(
      'SELECT caminho, servidor_id, video_original_id FROM videos WHERE codigo = ? AND codigo_cliente = ?',
      [video_id, userId]
    );

    if (videoRows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Vídeo não encontrado' 
      });
    }

    const video = videoRows[0];

    // Verificar se é um vídeo convertido (tem video_original_id)
    if (!video.video_original_id) {
      return res.status(400).json({
        success: false,
        error: 'Este não é um vídeo convertido'
      });
    }

    const serverId = video.servidor_id || 1;
    const remotePath = `/usr/local/WowzaStreamingEngine/content/${video.caminho}`;

    // Remover arquivo convertido do servidor
    try {
      await SSHManager.deleteFile(serverId, remotePath);
      console.log(`✅ Arquivo convertido removido: ${remotePath}`);
    } catch (fileError) {
      console.warn('Erro ao remover arquivo convertido:', fileError.message);
    }

    // Remover vídeo convertido do banco
    await db.execute(
      'DELETE FROM videos WHERE codigo = ?',
      [video_id]
    );
    
    // Remover de playlists se estiver sendo usado
    await db.execute(
      'DELETE FROM playlists_videos WHERE codigo_video = ?',
      [video_id]
    );

    res.json({
      success: true,
      message: 'Conversão removida com sucesso'
    });
  } catch (error) {
    console.error('Erro ao remover conversão:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao remover conversão',
      details: error.message 
    });
  }
});

module.exports = router;