const mysql = require('mysql2/promise');

const isProduction = process.env.NODE_ENV === 'production';

const dbConfig = {
  host: '104.251.209.68',
  port: 35689,
  user: 'admin',
  password: 'Adr1an@',
  database: 'db_SamCast',
  charset: 'utf8mb4',
  timezone: '+00:00',
  ...(isProduction && {
    ssl: false,
    connectTimeout: 60000,
    acquireTimeout: 60000,
    timeout: 60000,
  })
};

// Pool de conexões
const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Função para testar conexão
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Conectado ao MySQL com sucesso!');
    
    // Verificar se tabela videos existe, se não, criar
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS videos (
        codigo INT AUTO_INCREMENT PRIMARY KEY,
        codigo_cliente INT NOT NULL,
        nome VARCHAR(255) NOT NULL,
        caminho TEXT NOT NULL,
        tamanho_arquivo BIGINT DEFAULT 0,
        duracao_segundos INT DEFAULT 0,
        bitrate_video INT DEFAULT 0,
        formato_original VARCHAR(50),
        largura INT DEFAULT 0,
        altura INT DEFAULT 0,
        codec_video VARCHAR(50),
        is_mp4 TINYINT(1) DEFAULT 0,
        compativel TINYINT(1) DEFAULT 1,
        motivos_incompatibilidade JSON,
        pasta VARCHAR(255),
        servidor_id INT DEFAULT 1,
        video_original_id INT NULL,
        qualidade_conversao VARCHAR(50) NULL,
        data_upload TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        data_atualizacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_cliente_pasta (codigo_cliente, pasta),
        INDEX idx_compativel (compativel),
        INDEX idx_upload (data_upload),
        INDEX idx_original (video_original_id),
        FOREIGN KEY (video_original_id) REFERENCES videos(codigo) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('✅ Tabela videos verificada/criada');
    
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ Erro ao conectar ao MySQL:', error.message);
    return false;
  }
}

module.exports = {
  pool,
  testConnection,
  execute: (query, params) => pool.execute(query, params),
  query: (query, params) => pool.query(query, params)
};