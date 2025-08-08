const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const authMiddleware = require('../middlewares/authMiddleware');
const SSHManager = require('../config/SSHManager');
const ffmpeg = require('fluent-ffmpeg');

const router = express.Router();

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const tempDir = '/tmp/video-uploads';
      await fs.mkdir(tempDir, { recursive: true });
      cb(null, tempDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const sanitizedName = file.originalname
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/_{2,}/g, '_');
    cb(null, `${Date.now()}_${sanitizedName}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    // Lista expandida de tipos MIME para vídeos
    const allowedTypes = [
      'video/mp4', 'video/avi', 'video/quicktime', 'video/x-msvideo',
      'video/wmv', 'video/x-ms-wmv', 'video/flv', 'video/x-flv',
      'video/webm', 'video/mkv', 'video/x-matroska', 'video/3gpp',
      'video/3gpp2', 'video/mp2t', 'video/mpeg', 'video/ogg',
      'application/octet-stream' // Para arquivos que podem não ter MIME correto
    ];

    // Verificar também por extensão para todos os formatos
    const fileName = file.originalname.toLowerCase();
    const hasValidExtension = [
      '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv',
      '.3gp', '.3g2', '.ts', '.mpg', '.mpeg', '.ogv', '.m4v', '.asf'
    ].some(ext =>
      fileName.endsWith(ext)
    );

    if (allowedTypes.includes(file.mimetype) || hasValidExtension) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de arquivo não suportado: ${file.mimetype}. Extensões aceitas: .mp4, .avi, .mov, .wmv, .flv, .webm, .mkv, .3gp, .ts, .mpg, .ogv, .m4v`), false);
    }
  }
});

// Função para obter informações do vídeo usando ffprobe
async function getVideoInfo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.error('Erro ao obter informações do vídeo:', err);
        resolve({
          duration: 0,
          bitrate: 0,
          width: 0,
          height: 0,
          format: 'unknown',
          codec: 'unknown'
        });
        return;
      }

      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
      
      const duration = Math.floor(metadata.format.duration || 0);
      const bitrate = Math.floor((metadata.format.bit_rate || 0) / 1000); // Converter para kbps
      const width = videoStream?.width || 0;
      const height = videoStream?.height || 0;
      const format = metadata.format.format_name || 'unknown';
      const codec = videoStream?.codec_name || 'unknown';

      resolve({
        duration,
        bitrate,
        width,
        height,
        format,
        codec
      });
    });
  });
}

// Função para verificar se vídeo é compatível
function isVideoCompatible(fileExtension, bitrate, userBitrateLimit) {
  const isMP4 = fileExtension === '.mp4';
  const bitrateOk = bitrate <= userBitrateLimit;
  
  return {
    isCompatible: isMP4 && bitrateOk,
    needsConversion: !isMP4 || !bitrateOk,
    reasons: [
      ...(!isMP4 ? ['Formato não é MP4'] : []),
      ...(!bitrateOk ? [`Bitrate ${bitrate} kbps excede limite de ${userBitrateLimit} kbps`] : [])
    ]
  };
}
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const folderId = req.query.folder_id;
    if (!folderId) {
      return res.status(400).json({ error: 'folder_id é obrigatório' });
    }

    const [folderRows] = await db.execute(
      'SELECT identificacao FROM streamings WHERE codigo = ? AND codigo_cliente = ?',
      [folderId, userId]
    );
    if (folderRows.length === 0) {
      return res.status(404).json({ error: 'Pasta não encontrada' });
    }

    const folderName = folderRows[0].identificacao;
    const userLogin = req.user.email.split('@')[0];

    const userBitrateLimit = req.user.bitrate || 2500;

    // Buscar vídeos da tabela videos que pertencem ao usuário e pasta
    const [rows] = await db.execute(
      `SELECT 
        v.codigo as id,
        v.nome,
        v.caminho as url,
        v.duracao_segundos as duracao,
        v.tamanho_arquivo as tamanho,
        v.bitrate_video,
        v.formato_original,
        v.largura,
        v.altura,
        v.codec_video,
        v.is_mp4,
        v.compativel,
        v.motivos_incompatibilidade,
        v.data_upload
       FROM videos v
       WHERE v.codigo_cliente = ? AND v.pasta = ?
       ORDER BY v.data_upload DESC`,
      [userId, folderName]
    );

    console.log(`📁 Buscando vídeos na pasta: ${folderName}`);
    console.log(`📊 Encontrados ${rows.length} vídeos no banco`);
    const videos = rows.map(video => {
      // Verificar compatibilidade
      const compatibility = isVideoCompatible(
        path.extname(video.nome).toLowerCase(),
        video.bitrate_video || 0,
        userBitrateLimit
      );

      return {
        id: video.id,
        nome: video.nome,
        url: video.url,
        duracao: video.duracao,
        tamanho: video.tamanho,
        bitrate_video: video.bitrate_video,
        formato_original: video.formato_original,
        largura: video.largura,
        altura: video.altura,
        codec_video: video.codec_video,
        is_mp4: video.is_mp4,
        compativel: video.compativel,
        motivos_incompatibilidade: video.motivos_incompatibilidade ? 
          JSON.parse(video.motivos_incompatibilidade) : [],
        data_upload: video.data_upload,
        folder: folderName,
        user: userLogin,
        // Informações de compatibilidade calculadas
        can_use_in_playlist: compatibility.isCompatible,
        needs_conversion: compatibility.needsConversion,
        compatibility_reasons: compatibility.reasons
      };
    });

    console.log(`✅ Retornando ${videos.length} vídeos com informações de compatibilidade`);
    res.json(videos);
  } catch (err) {
    console.error('Erro ao buscar vídeos:', err);
    res.status(500).json({ error: 'Erro ao buscar vídeos', details: err.message });
  }
});

router.post('/upload', authMiddleware, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];
    const folderId = req.query.folder_id || 'default';
    const userBitrateLimit = req.user.bitrate || 2500;

    console.log(`📤 Upload iniciado - Usuário: ${userLogin}, Pasta: ${folderId}, Arquivo: ${req.file.originalname}`);
    console.log(`📋 Tipo MIME: ${req.file.mimetype}, Tamanho: ${req.file.size} bytes`);

    // Verificar se é um formato de vídeo válido
    const videoExtensions = [
      '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv',
      '.3gp', '.3g2', '.ts', '.mpg', '.mpeg', '.ogv', '.m4v', '.asf'
    ];
    const fileExtension = path.extname(req.file.originalname).toLowerCase();

    if (!videoExtensions.includes(fileExtension)) {
      console.log(`❌ Extensão não suportada: ${fileExtension}`);
      await fs.unlink(req.file.path).catch(() => { });
      return res.status(400).json({
        error: `Formato de arquivo não suportado: ${fileExtension}`,
        details: `Formatos aceitos: ${videoExtensions.join(', ')}`
      });
    }

    const tamanho = parseInt(req.body.tamanho) || req.file.size;

    // Obter informações detalhadas do vídeo
    console.log(`🔍 Analisando vídeo: ${req.file.originalname}`);
    const videoInfo = await getVideoInfo(req.file.path);
    
    console.log(`📊 Informações do vídeo:`, {
      duration: videoInfo.duration,
      bitrate: videoInfo.bitrate,
      width: videoInfo.width,
      height: videoInfo.height,
      format: videoInfo.format,
      codec: videoInfo.codec
    });
    const [userRows] = await db.execute(
      `SELECT 
        s.codigo_servidor, s.identificacao as folder_name,
        s.espaco, s.espaco_usado
       FROM streamings s 
       WHERE s.codigo = ? AND s.codigo_cliente = ?`,
      [folderId, userId]
    );
    if (userRows.length === 0) {
      console.log(`❌ Pasta ${folderId} não encontrada para usuário ${userId}`);
      return res.status(404).json({ error: 'Pasta não encontrada' });
    }

    const userData = userRows[0];
    const serverId = userData.codigo_servidor || 1;
    const folderName = userData.folder_name;

    console.log(`📁 Pasta encontrada: ${folderName}, Servidor: ${serverId}`);

    const spaceMB = Math.ceil(tamanho / (1024 * 1024));
    const availableSpace = userData.espaco - userData.espaco_usado;

    if (spaceMB > availableSpace) {
      console.log(`❌ Espaço insuficiente: ${spaceMB}MB necessário, ${availableSpace}MB disponível`);
      await fs.unlink(req.file.path).catch(() => { });
      return res.status(400).json({
        error: `Espaço insuficiente. Necessário: ${spaceMB}MB, Disponível: ${availableSpace}MB`,
        details: `Seu plano permite ${userData.espaco}MB de armazenamento. Atualmente você está usando ${userData.espaco_usado}MB. Para enviar este arquivo, você precisa de mais ${spaceMB - availableSpace}MB livres.`,
        spaceInfo: {
          required: spaceMB,
          available: availableSpace,
          total: userData.espaco,
          used: userData.espaco_usado,
          percentage: Math.round((userData.espaco_usado / userData.espaco) * 100)
        }
      });
    }

    // Verificar compatibilidade do vídeo
    const compatibility = isVideoCompatible(fileExtension, videoInfo.bitrate, userBitrateLimit);
    
    console.log(`🔍 Compatibilidade do vídeo:`, {
      isCompatible: compatibility.isCompatible,
      needsConversion: compatibility.needsConversion,
      reasons: compatibility.reasons
    });
    await SSHManager.createUserDirectory(serverId, userLogin);
    await SSHManager.createUserFolder(serverId, userLogin, folderName);

    const remotePath = `/usr/local/WowzaStreamingEngine/content/${userLogin}/${folderName}/${req.file.filename}`;
    await SSHManager.uploadFile(serverId, req.file.path, remotePath);
    await fs.unlink(req.file.path);

    console.log(`✅ Arquivo enviado para: ${remotePath}`);

    // Salvar vídeo na tabela videos
    const [videoResult] = await db.execute(
      `INSERT INTO videos (
        codigo_cliente, nome, caminho, tamanho_arquivo, duracao_segundos,
        bitrate_video, formato_original, largura, altura, codec_video,
        is_mp4, compativel, motivos_incompatibilidade, pasta, servidor_id,
        data_upload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        userId,
        req.file.originalname,
        `${userLogin}/${folderName}/${req.file.filename}`,
        tamanho,
        videoInfo.duration,
        videoInfo.bitrate,
        videoInfo.format,
        videoInfo.width,
        videoInfo.height,
        videoInfo.codec,
        fileExtension === '.mp4' ? 1 : 0,
        compatibility.isCompatible ? 1 : 0,
        JSON.stringify(compatibility.reasons),
        folderName,
        serverId
      ]
    );

    await db.execute(
      'UPDATE streamings SET espaco_usado = espaco_usado + ? WHERE codigo = ?',
      [spaceMB, folderId]
    );

    console.log(`✅ Vídeo salvo no banco com ID: ${videoResult.insertId}`);

    // Construir URL relativa
    const relativePath = `${userLogin}/${folderName}/${req.file.filename}`;
    res.status(201).json({
      id: videoResult.insertId,
      nome: req.file.originalname,
      url: relativePath,
      path: remotePath,
      duracao: videoInfo.duration,
      tamanho: tamanho,
      bitrate_video: videoInfo.bitrate,
      formato_original: videoInfo.format,
      largura: videoInfo.width,
      altura: videoInfo.height,
      codec_video: videoInfo.codec,
      is_mp4: fileExtension === '.mp4',
      compativel: compatibility.isCompatible,
      motivos_incompatibilidade: compatibility.reasons,
      needs_conversion: compatibility.needsConversion,
      can_use_in_playlist: compatibility.isCompatible
    });
  } catch (err) {
    console.error('Erro no upload:', err);
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => { });
    }
    res.status(500).json({ error: 'Erro no upload do vídeo', details: err.message });
  }
});

// Função auxiliar para formatar duração
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Rota para testar acesso a vídeos
router.get('/test/:userId/:folder/:filename', authMiddleware, async (req, res) => {
  try {
    const { userId, folder, filename } = req.params;
    const userLogin = req.user.email.split('@')[0];

    // Verificar se arquivo existe no servidor via SSH
    const [serverRows] = await db.execute(
      'SELECT codigo_servidor FROM streamings WHERE codigo_cliente = ? LIMIT 1',
      [userId]
    );

    const serverId = serverRows.length > 0 ? serverRows[0].codigo_servidor : 1;
    const remotePath = `/usr/local/WowzaStreamingEngine/content/${userLogin}/${folder}/${filename}`;

    try {
      const fileInfo = await SSHManager.getFileInfo(serverId, remotePath);

      if (fileInfo.exists) {
        res.json({
          success: true,
          exists: true,
          path: remotePath,
          info: fileInfo,
          url: `/content/${userLogin}/${folder}/${filename}`
        });
      } else {
        res.json({
          success: false,
          url: `/content${relativePath}`,
          error: 'Arquivo não encontrado no servidor'
        });
      }
    } catch (sshError) {
      res.status(500).json({
        success: false,
        error: 'Erro ao verificar arquivo no servidor',
        details: sshError.message
      });
    }
  } catch (err) {
    console.error('Erro no teste de vídeo:', err);
    res.status(500).json({ error: 'Erro no teste de vídeo', details: err.message });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const videoId = req.params.id;
    const userId = req.user.id;
    const userLogin = req.user.email.split('@')[0];

    // Buscar dados do vídeo na tabela videos
    const [videoRows] = await db.execute(
      'SELECT caminho, nome, tamanho_arquivo, pasta, servidor_id FROM videos WHERE codigo = ? AND codigo_cliente = ?',
      [videoId, userId]
    );
    
    if (videoRows.length === 0) {
      return res.status(404).json({ error: 'Vídeo não encontrado' });
    }

    const { caminho, nome, tamanho_arquivo, pasta, servidor_id } = videoRows[0];

    if (!caminho.includes(`/${userLogin}/`)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const serverId = servidor_id || 1;
    const remotePath = `/usr/local/WowzaStreamingEngine/content/${caminho}`;

    let fileSize = tamanho_arquivo || 0;

    // Verificar tamanho real do arquivo via SSH, se necessário
    if (!fileSize) {
      try {
        const fileInfo = await SSHManager.getFileInfo(serverId, remotePath);
        fileSize = fileInfo.exists ? fileInfo.size : 0;
      } catch (err) {
        console.warn('Não foi possível verificar tamanho do arquivo via SSH:', err.message);
      }
    }

    // Remover arquivo via SSH
    try {
      await SSHManager.deleteFile(serverId, remotePath);
      console.log(`✅ Arquivo remoto removido: ${remotePath}`);
    } catch (err) {
      console.warn('Erro ao deletar arquivo remoto:', err.message);
    }

    // Remover vídeo da tabela videos
    await db.execute('DELETE FROM videos WHERE codigo = ?', [videoId]);
    
    // Remover vídeo de todas as playlists que o referenciam
    await db.execute('DELETE FROM playlists_videos WHERE codigo_video = ?', [videoId]);
    
    // Atualizar espaço usado na pasta
    const spaceMB = Math.ceil(fileSize / (1024 * 1024));
    await db.execute(
      'UPDATE streamings SET espaco_usado = GREATEST(espaco_usado - ?, 0) WHERE codigo_cliente = ? AND identificacao = ?',
      [spaceMB, userId, pasta]
    );
    
    console.log(`📊 Espaço liberado: ${spaceMB}MB da pasta ${pasta}`);

    return res.json({ success: true, message: 'Vídeo removido com sucesso' });
  } catch (err) {
    console.error('Erro ao remover vídeo:', err);
    return res.status(500).json({ error: 'Erro ao remover vídeo', details: err.message });
  }
});

module.exports = router;