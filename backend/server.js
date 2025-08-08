  const express = require('express');
  const cors = require('cors');
  const path = require('path');
  const db = require('./config/database');
  const SSHManager = require('./config/SSHManager');


  // Importar rotas
  const authRoutes = require('./routes/auth');
  const foldersRoutes = require('./routes/folders');
  const videosRoutes = require('./routes/videos');
  const playlistsRoutes = require('./routes/playlists');
  const agendamentosRoutes = require('./routes/agendamentos');
  const comerciaisRoutes = require('./routes/comerciais');
  const downloadyoutubeRoutes = require('./routes/downloadyoutube');
  const espectadoresRoutes = require('./routes/espectadores');
  const streamingRoutes = require('./routes/streaming');
  const relayRoutes = require('./routes/relay');
  const logosRoutes = require('./routes/logos');
  const transmissionSettingsRoutes = require('./routes/transmission-settings');
  const ftpRoutes = require('./routes/ftp');
  const serversRoutes = require('./routes/servers');
 const playersRoutes = require('./routes/players');
 const videosSSHRoutes = require('./routes/videos-ssh');
 const conversionRoutes = require('./routes/conversion');

  const app = express();
  const PORT = process.env.PORT || 3001;
  const isProduction = process.env.NODE_ENV === 'production';

  // Middlewares
  app.use(cors({
    origin: isProduction ? [
      'http://samhost.wcore.com.br',
      'https://samhost.wcore.com.br',
      'http://samhost.wcore.com.br:3000'
    ] : [
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    ],
    credentials: true
  }));
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Servir arquivos estáticos do Wowza
  // Middleware personalizado para servir arquivos de vídeo
  app.use('/content', async (req, res, next) => {
    try {
      // Verificar autenticação para acesso a vídeos
      let token = null;
      
      // Verificar token no header Authorization
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
      
      // Verificar token no query parameter (para nova aba)
      if (!token && req.query.auth_token) {
        token = req.query.auth_token;
      }
      
      if (!token) {
        console.log('❌ Token de acesso não fornecido para /content:', {
          path: req.path,
          method: req.method,
          headers: Object.keys(req.headers),
          query: Object.keys(req.query || {}),
          hasAuthHeader: !!authHeader,
          hasQueryToken: !!req.query.auth_token
        });
        return res.status(401).json({ error: 'Token de acesso requerido' });
      }

      try {
        const jwt = require('jsonwebtoken');
        const JWT_SECRET = process.env.JWT_SECRET || 'sua_chave_secreta_super_segura_aqui';
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Adicionar dados do usuário à requisição
        req.user = decoded;
        console.log('✅ Token validado para /content:', {
          userId: decoded.userId,
          email: decoded.email,
          path: req.path
        });
      } catch (jwtError) {
        console.error('Erro de autenticação no middleware de vídeo:', jwtError.message);
        return res.status(401).json({ error: 'Token inválido' });
      }

      // Extrair informações do caminho
      const requestPath = req.path.startsWith('/') ? req.path : `/${req.path}`;
      console.log(`📹 Solicitação de vídeo: ${requestPath}`);
      
      // Se for uma URL SSH, não processar aqui - deixar para as rotas SSH
      if (requestPath.includes('/api/videos-ssh/')) {
        console.log(`🔄 Redirecionando para rota SSH: ${requestPath}`);
        return next();
      }
      
      // Verificar se é um arquivo de vídeo ou playlist
      const isVideoFile = /\.(mp4|avi|mov|wmv|flv|webm|mkv)$/i.test(requestPath);
      const isStreamFile = /\.(m3u8|ts)$/i.test(requestPath);
      
      if (!isVideoFile && !isStreamFile) {
        console.log(`❌ Tipo de arquivo não suportado: ${requestPath}`);
        return res.status(404).json({ error: 'Arquivo não encontrado' });
      }
      
      // Configurar headers para streaming de vídeo
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.setHeader('Accept-Ranges', 'bytes');
      
      // Definir Content-Type baseado na extensão
      if (isStreamFile && requestPath.includes('.m3u8')) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      } else if (isStreamFile && requestPath.includes('.ts')) {
        res.setHeader('Content-Type', 'video/mp2t');
      } else if (requestPath.includes('.mp4')) {
        res.setHeader('Content-Type', 'video/mp4');
      } else if (requestPath.includes('.avi')) {
        res.setHeader('Content-Type', 'video/x-msvideo');
      } else if (requestPath.includes('.mov')) {
        res.setHeader('Content-Type', 'video/quicktime');
      } else if (requestPath.includes('.wmv')) {
        res.setHeader('Content-Type', 'video/x-ms-wmv');
      } else if (requestPath.includes('.webm')) {
        res.setHeader('Content-Type', 'video/webm');
      } else if (requestPath.includes('.mkv')) {
        res.setHeader('Content-Type', 'video/x-matroska');
      } else {
        res.setHeader('Content-Type', 'video/mp4');
      }
      
      // Cache diferente para streams vs arquivos
      if (isStreamFile) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
      
      // Limpar e processar caminho
      const cleanPath = requestPath.replace('/content/', '').replace(/^\/+/, '');
      const pathParts = cleanPath.split('/');
      
      if (pathParts.length < 3) {
        console.log(`❌ Caminho inválido: ${requestPath}`);
        return res.status(404).json({ error: 'Caminho de vídeo inválido' });
      }
      
      const userLogin = pathParts[0];
      const folderName = pathParts[1];
      const fileName = pathParts[2];
      
      // Verificar se é MP4 ou precisa de conversão
      const fileExtension = path.extname(fileName).toLowerCase();
      const needsConversion = !['.mp4'].includes(fileExtension);
      
      // Nome do arquivo final (MP4)
      const finalFileName = needsConversion ? 
        fileName.replace(/\.[^/.]+$/, '.mp4') : fileName;
      
      // Configurar URL do Wowza
      const fetch = require('node-fetch');
      const isProduction = process.env.NODE_ENV === 'production';
      const wowzaHost = isProduction ? 'samhost.wcore.com.br' : '51.222.156.223';
      const wowzaUser = 'admin';
      const wowzaPassword = 'FK38Ca2SuE6jvJXed97VMn';
      
      let wowzaUrl;
      if (isStreamFile) {
        // Para streams HLS - usar formato correto do Wowza
        wowzaUrl = `http://${wowzaHost}:1935/vod/_definst_/mp4:${userLogin}/${folderName}/${finalFileName}/playlist.m3u8`;
      } else {
        // Para arquivos de vídeo diretos - usar porta 6980
        wowzaUrl = `http://${wowzaUser}:${wowzaPassword}@${wowzaHost}:6980/content/${userLogin}/${folderName}/${finalFileName}`;
      }
      
      console.log(`🔗 Redirecionando para: ${wowzaUrl}`);
      
      try {
        const requestHeaders = {
          'Range': req.headers.range || '',
          'User-Agent': 'Streaming-System/1.0',
          'Accept': '*/*',
          'Cache-Control': isStreamFile ? 'no-cache' : 'public, max-age=3600',
          'Connection': 'keep-alive'
        };
        
        const wowzaResponse = await fetch(wowzaUrl, {
          method: req.method,
          headers: requestHeaders,
          timeout: 15000
        });
        
        if (!wowzaResponse.ok) {
          console.log(`❌ Erro ao acessar vídeo (${wowzaResponse.status}): ${wowzaUrl}`);
          
          // Se falhou com MP4, tentar com arquivo original
          if (needsConversion && finalFileName !== fileName) {
            console.log(`🔄 Tentando arquivo original: ${fileName}`);
            const originalUrl = isStreamFile ? 
              `http://${wowzaHost}:1935/vod/_definst_/mp4:${userLogin}/${folderName}/${fileName}/playlist.m3u8` :
              `http://${wowzaUser}:${wowzaPassword}@${wowzaHost}:6980/content/${userLogin}/${folderName}/${fileName}`;
            
            const originalResponse = await fetch(originalUrl, {
              method: req.method,
              headers: requestHeaders,
              timeout: 15000
            });
            
            if (originalResponse.ok) {
              console.log(`✅ Servindo arquivo original: ${originalUrl}`);
              originalResponse.headers.forEach((value, key) => {
                if (!res.headersSent) {
                  res.setHeader(key, value);
                }
              });
              return originalResponse.body.pipe(res);
            }
          }
          
          return res.status(404).json({ 
            error: 'Vídeo não encontrado',
            details: 'O arquivo não foi encontrado no servidor de streaming'
          });
        }
        
        console.log(`✅ Servindo vídeo via Wowza: ${wowzaUrl}`);
        
        // Copiar headers da resposta do Wowza
        wowzaResponse.headers.forEach((value, key) => {
          if (!res.headersSent) {
            res.setHeader(key, value);
          }
        });
        
        // Fazer pipe do stream
        wowzaResponse.body.pipe(res);
        
      } catch (fetchError) {
        console.error('❌ Erro ao acessar Wowza:', fetchError);
        return res.status(500).json({ 
          error: 'Erro interno do servidor de streaming',
          details: fetchError.message 
        });
      }
    } catch (error) {
      console.error('❌ Erro no middleware de vídeo:', error);
      return res.status(500).json({ 
        error: 'Erro interno do servidor',
        details: error.message 
      });
    }
  });
  
  // Servir arquivos estáticos do frontend em produção
  if (isProduction) {
    app.use(express.static(path.join(__dirname, '../dist')));
    
    // Catch all handler: send back React's index.html file for SPA routing
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(__dirname, '../dist/index.html'));
      }
    });
  }

  // Rotas da API
  app.use('/api/auth', authRoutes);
  app.use('/api/folders', foldersRoutes);
  app.use('/api/videos', videosRoutes);
  app.use('/api/playlists', playlistsRoutes);
  app.use('/api/agendamentos', agendamentosRoutes);
  app.use('/api/comerciais', comerciaisRoutes);
  app.use('/api/downloadyoutube', downloadyoutubeRoutes);
  app.use('/api/espectadores', espectadoresRoutes);
  app.use('/api/streaming', streamingRoutes);
  app.use('/api/relay', relayRoutes);
  app.use('/api/logos', logosRoutes);
  app.use('/api/transmission-settings', transmissionSettingsRoutes);
  app.use('/api/ftp', ftpRoutes);
  app.use('/api/servers', serversRoutes);
 app.use('/api/players', playersRoutes);
 app.use('/api/videos-ssh', videosSSHRoutes);
 app.use('/api/user-settings', require('./routes/user-settings'));
 app.use('/api/conversion', conversionRoutes);

  // Rota de teste
  app.get('/api/test', (req, res) => {
    res.json({ message: 'API funcionando!', timestamp: new Date().toISOString() });
  });

  // Rota de health check
  app.get('/api/health', async (req, res) => {
    try {
      const dbConnected = await db.testConnection();
      res.json({
        status: 'ok',
        database: dbConnected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        database: 'disconnected',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Middleware de tratamento de erros
  app.use((error, req, res, next) => {
    console.error('Erro não tratado:', error);
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Arquivo muito grande' });
    }
    
    if (error.message.includes('Tipo de arquivo não suportado')) {
      return res.status(400).json({ error: 'Tipo de arquivo não suportado' });
    }
    
    res.status(500).json({ error: 'Erro interno do servidor' });
  });

  // Rota 404
  app.use('*', (req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
  });

  // Iniciar servidor
  async function startServer() {
    try {
      // Testar conexão com banco
      const dbConnected = await db.testConnection();
      
      if (!dbConnected) {
        console.error('❌ Não foi possível conectar ao banco de dados');
        process.exit(1);
      }

      app.listen(PORT, () => {
        console.log(`🚀 Servidor rodando na porta ${PORT}`);
        console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
        console.log(`🔧 API test: http://localhost:${PORT}/api/test`);
        console.log(`🔗 SSH Manager inicializado para uploads remotos`);
      });
      
      // Cleanup ao fechar aplicação
      process.on('SIGINT', () => {
        console.log('\n🔌 Fechando conexões SSH...');
        SSHManager.closeAllConnections();
        process.exit(0);
      });
      
      process.on('SIGTERM', () => {
        console.log('\n🔌 Fechando conexões SSH...');
        SSHManager.closeAllConnections();
        process.exit(0);
      });
    } catch (error) {
      console.error('❌ Erro ao iniciar servidor:', error);
      process.exit(1);
    }
  }

  startServer();