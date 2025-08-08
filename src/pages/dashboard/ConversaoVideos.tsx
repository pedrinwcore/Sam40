import React, { useState, useEffect } from 'react';
import { ChevronLeft, Video, Settings, Play, Trash2, RefreshCw, AlertCircle, CheckCircle, Zap, HardDrive, Clock, Download, X, Maximize, Minimize } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../../context/AuthContext';

interface VideoConversion {
  id: number;
  nome: string;
  url: string;
  duracao?: number;
  tamanho?: number;
  bitrate_video?: number;
  formato_original?: string;
  status_conversao?: 'nao_iniciada' | 'em_andamento' | 'concluida' | 'erro';
  path_video_mp4?: string;
  data_conversao?: string;
  is_mp4: boolean;
  current_bitrate: number;
  user_bitrate_limit: number;
  available_qualities: Array<{
    quality: string;
    bitrate: number;
    resolution: string;
    canConvert: boolean;
    reason?: string;
    description: string;
  }>;
  can_use_current: boolean;
  needs_conversion: boolean;
  conversion_status: string;
  qualidade_conversao?: string;
}

interface Folder {
  id: number;
  nome: string;
}

interface QualityPreset {
  quality: string;
  label: string;
  bitrate: number;
  resolution: string;
  available: boolean;
  description: string;
}

interface ConversionSettings {
  quality?: string;
  custom_bitrate?: number;
  custom_resolution?: string;
  use_custom: boolean;
}

const ConversaoVideos: React.FC = () => {
  const { getToken, user } = useAuth();
  const [videos, setVideos] = useState<VideoConversion[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [converting, setConverting] = useState<Record<number, boolean>>({});
  const [showConversionModal, setShowConversionModal] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<VideoConversion | null>(null);
  const [conversionSettings, setConversionSettings] = useState<ConversionSettings>({
    quality: 'media',
    use_custom: false
  });
  const [qualityPresets, setQualityPresets] = useState<QualityPreset[]>([]);
  
  // Player modal state
  const [showPlayerModal, setShowPlayerModal] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<VideoConversion | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    loadFolders();
    loadQualityPresets();
  }, []);

  useEffect(() => {
    if (selectedFolder) {
      loadVideos();
    }
  }, [selectedFolder]);

  const loadFolders = async () => {
    try {
      const token = await getToken();
      const response = await fetch('/api/folders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      setFolders(data);
      
      // Selecionar primeira pasta por padrão
      if (data.length > 0) {
        setSelectedFolder(data[0].id.toString());
      }
    } catch (error) {
      toast.error('Erro ao carregar pastas');
    }
  };

  const loadQualityPresets = async () => {
    try {
      const token = await getToken();
      const response = await fetch('/api/conversion/qualities', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setQualityPresets(data.qualities);
        }
      }
    } catch (error) {
      console.error('Erro ao carregar qualidades:', error);
    }
  };

  const loadVideos = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const url = selectedFolder ? 
        `/api/conversion/videos?folder_id=${selectedFolder}` : 
        '/api/conversion/videos';
        
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setVideos(data.videos);
        }
      }
    } catch (error) {
      console.error('Erro ao carregar vídeos:', error);
      toast.error('Erro ao carregar vídeos');
    } finally {
      setLoading(false);
    }
  };

  const openConversionModal = (video: VideoConversion) => {
    setSelectedVideo(video);
    
    // Definir qualidade padrão baseada no bitrate atual
    let defaultQuality = 'media';
    if (video.current_bitrate <= 800) defaultQuality = 'baixa';
    else if (video.current_bitrate <= 1500) defaultQuality = 'media';
    else if (video.current_bitrate <= 2500) defaultQuality = 'alta';
    else defaultQuality = 'fullhd';
    
    setConversionSettings({
      quality: defaultQuality,
      custom_bitrate: video.current_bitrate || user?.bitrate || 2500,
      custom_resolution: '1920x1080',
      use_custom: false
    });
    setShowConversionModal(true);
  };

  const startConversion = async () => {
    if (!selectedVideo) return;

    setConverting(prev => ({ ...prev, [selectedVideo.id]: true }));
    setShowConversionModal(false);

    try {
      const token = await getToken();
      const requestBody = conversionSettings.use_custom ? {
        video_id: selectedVideo.id,
        custom_bitrate: conversionSettings.custom_bitrate,
        custom_resolution: conversionSettings.custom_resolution
      } : {
        video_id: selectedVideo.id,
        quality: conversionSettings.quality
      };

      const response = await fetch('/api/conversion/convert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();

      if (result.success) {
        toast.success('Conversão iniciada com sucesso!');
        
        // Atualizar status do vídeo
        setVideos(prev => prev.map(v => 
          v.id === selectedVideo.id ? 
          { ...v, status_conversao: 'em_andamento' } : v
        ));

        // Verificar progresso a cada 5 segundos
        const progressInterval = setInterval(async () => {
          try {
            const statusResponse = await fetch(`/api/conversion/status/${selectedVideo.id}`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            
            if (statusResponse.ok) {
              const statusData = await statusResponse.json();
              if (statusData.success) {
                const status = statusData.conversion_status.status;
                
                if (status === 'concluida') {
                  clearInterval(progressInterval);
                  setConverting(prev => ({ ...prev, [selectedVideo.id]: false }));
                  toast.success(`Conversão de "${selectedVideo.nome}" concluída!`);
                  loadVideos(); // Recarregar lista
                } else if (status === 'erro') {
                  clearInterval(progressInterval);
                  setConverting(prev => ({ ...prev, [selectedVideo.id]: false }));
                  toast.error(`Erro na conversão de "${selectedVideo.nome}"`);
                  loadVideos();
                }
              }
            }
          } catch (error) {
            console.error('Erro ao verificar progresso:', error);
          }
        }, 5000);

        // Timeout de 10 minutos
        setTimeout(() => {
          clearInterval(progressInterval);
          setConverting(prev => ({ ...prev, [selectedVideo.id]: false }));
        }, 600000);

      } else {
        toast.error(result.error || 'Erro ao iniciar conversão');
      }
    } catch (error) {
      console.error('Erro ao converter vídeo:', error);
      toast.error('Erro ao converter vídeo');
    } finally {
      setConverting(prev => ({ ...prev, [selectedVideo.id]: false }));
    }
  };

  const removeConversion = async (videoId: number) => {
    if (!confirm('Deseja remover a conversão deste vídeo?')) return;

    try {
      const token = await getToken();
      const response = await fetch(`/api/conversion/${videoId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        toast.success('Conversão removida com sucesso!');
        loadVideos();
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || 'Erro ao remover conversão');
      }
    } catch (error) {
      toast.error('Erro ao remover conversão');
    }
  };

  const openVideoPlayer = (video: VideoConversion) => {
    setCurrentVideo(video);
    setShowPlayerModal(true);
  };

  const closeVideoPlayer = () => {
    setShowPlayerModal(false);
    setCurrentVideo(null);
    setIsFullscreen(false);
  };

  const buildVideoUrl = (url: string) => {
    if (!url) return '';
    
    // Se já é uma URL completa, usar como está
    if (url.startsWith('http')) {
      return url;
    }
    
    // Para vídeos SSH, usar URL diretamente
    if (url.includes('/api/videos-ssh/')) {
      return url;
    }
    
    // Todos os vídeos agora são MP4, usar proxy /content do backend
    const cleanPath = url.replace(/^\/+/, '');
    const token = localStorage.getItem('auth_token');
    const baseUrl = `/content/${cleanPath}`;
    return token ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}auth_token=${encodeURIComponent(token)}` : baseUrl;
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  };

  const formatDuration = (seconds: number): string => {
    if (!seconds) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const getStatusIcon = (video: VideoConversion) => {
    if (converting[video.id]) {
      return <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />;
    }

    switch (video.status_conversao) {
      case 'concluida':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'em_andamento':
        return <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />;
      case 'erro':
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      default:
        return <Video className="h-4 w-4 text-gray-600" />;
    }
  };

  const getStatusText = (video: VideoConversion) => {
    if (converting[video.id]) {
      return 'Convertendo...';
    }

    switch (video.status_conversao) {
      case 'concluida':
        return 'Convertido';
      case 'em_andamento':
        return 'Convertendo...';
      case 'erro':
        return 'Erro na conversão';
      default:
        if (video.is_mp4 && video.can_use_current) {
          return 'MP4 Original';
        }
        return 'Disponível para conversão';
    }
  };

  const getStatusColor = (video: VideoConversion) => {
    if (converting[video.id]) {
      return 'text-blue-600';
    }

    switch (video.status_conversao) {
      case 'concluida':
        return 'text-green-600';
      case 'em_andamento':
        return 'text-blue-600';
      case 'erro':
        return 'text-red-600';
      default:
        if (video.is_mp4 && video.can_use_current) {
          return 'text-green-600';
        }
        return 'text-yellow-600';
    }
  };

  const getQualityLabel = (quality: string) => {
    const labels: Record<string, string> = {
      baixa: 'Baixa (480p)',
      media: 'Média (720p)',
      alta: 'Alta (1080p)',
      fullhd: 'Full HD (1080p+)'
    };
    return labels[quality] || quality;
  };

  const totalVideos = videos.length;
  const needsConversion = videos.filter(v => v.needs_conversion && v.status_conversao !== 'concluida').length;
  const convertedVideos = videos.filter(v => v.status_conversao === 'concluida').length;
  const mp4Videos = videos.filter(v => v.is_mp4 && v.can_use_current).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center mb-6">
        <Link to="/dashboard" className="flex items-center text-primary-600 hover:text-primary-800">
          <ChevronLeft className="h-5 w-5 mr-1" />
          <span>Voltar ao Dashboard</span>
        </Link>
      </div>

      <div className="flex items-center space-x-3">
        <Video className="h-8 w-8 text-primary-600" />
        <h1 className="text-3xl font-bold text-gray-900">Conversão de Vídeos</h1>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Video className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total de Vídeos</p>
              <p className="text-2xl font-bold text-gray-900">{totalVideos}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center">
            <div className="p-3 bg-green-100 rounded-lg">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">MP4 Originais</p>
              <p className="text-2xl font-bold text-gray-900">{mp4Videos}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center">
            <div className="p-3 bg-yellow-100 rounded-lg">
              <Settings className="h-6 w-6 text-yellow-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Podem Converter</p>
              <p className="text-2xl font-bold text-gray-900">{needsConversion}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center">
            <div className="p-3 bg-purple-100 rounded-lg">
              <Zap className="h-6 w-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Convertidos</p>
              <p className="text-2xl font-bold text-gray-900">{convertedVideos}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-800">Filtros</h2>
          <button
            onClick={loadVideos}
            disabled={loading}
            className="bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700 disabled:opacity-50 flex items-center"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Pasta
            </label>
            <select
              value={selectedFolder}
              onChange={(e) => setSelectedFolder(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">Todas as pastas</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <div className="text-sm text-gray-600">
              <p>Limite do seu plano: <strong>{user?.bitrate || 2500} kbps</strong></p>
              <p>Armazenamento: <strong>{user?.espaco || 1000} MB</strong></p>
            </div>
          </div>
        </div>
      </div>

      {/* Lista de vídeos */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">Todos os Vídeos</h2>

        {videos.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Video className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="text-lg mb-2">Nenhum vídeo encontrado</p>
            <p className="text-sm">Selecione uma pasta ou envie vídeos primeiro</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Vídeo</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-700">Formato</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-700">Bitrate Atual</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-700">Tamanho</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-700">Status</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-700">Ações</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((video) => (
                  <tr key={video.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-3">
                        <Video className="h-5 w-5 text-gray-400" />
                        <div>
                          <div className="font-medium text-gray-900 truncate max-w-xs" title={video.nome}>
                            {video.nome}
                          </div>
                          {video.duracao && (
                            <div className="text-sm text-gray-500">
                              {formatDuration(video.duracao)}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        video.is_mp4 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {video.formato_original?.toUpperCase() || 'N/A'}
                      </span>
                    </td>
                    
                    <td className="py-3 px-4 text-center">
                      <div className="flex flex-col items-center">
                        <span className={`font-medium ${
                          (video.bitrate_original || video.current_bitrate) > video.user_bitrate_limit ? 'text-red-600' : 'text-gray-900'
                        }`}>
                          {video.bitrate_original || video.current_bitrate || 'N/A'} kbps
                        </span>
                        {(video.bitrate_original || video.current_bitrate) > video.user_bitrate_limit && (
                          <span className="text-xs text-red-600">
                            Limite: {video.user_bitrate_limit} kbps
                          </span>
                        )}
                      </div>
                    </td>
                    
                    <td className="py-3 px-4 text-center text-sm text-gray-600">
                      {video.tamanho ? formatFileSize(video.tamanho) : 'N/A'}
                    </td>
                    
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center space-x-2">
                        {getStatusIcon(video)}
                        <span className={`text-sm font-medium ${getStatusColor(video)}`}>
                          {getStatusText(video)}
                        </span>
                      </div>
                    </td>
                    
                    <td className="py-3 px-4 text-center">
                      <div className="flex justify-center space-x-2">
                        <button
                          onClick={() => openVideoPlayer(video)}
                          className="text-blue-600 hover:text-blue-800 p-1"
                          title="Visualizar vídeo"
                        >
                          <Play className="h-4 w-4" />
                        </button>
                        
                        <button
                          onClick={() => openConversionModal(video)}
                          disabled={converting[video.id] || video.status_conversao === 'em_andamento'}
                          className="text-purple-600 hover:text-purple-800 disabled:opacity-50 p-1"
                          title="Converter vídeo"
                        >
                          <Settings className="h-4 w-4" />
                        </button>
                        
                        {video.status_conversao === 'concluida' && (
                          <button
                            onClick={() => removeConversion(video.id)}
                            className="text-red-600 hover:text-red-800 p-1"
                            title="Remover conversão"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de Configuração de Conversão */}
      {showConversionModal && selectedVideo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Configurar Conversão</h3>
                <button
                  onClick={() => setShowConversionModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Vídeo: {selectedVideo.nome}
              </p>
            </div>

            <div className="p-6 space-y-6">
              {/* Informações do vídeo atual */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="font-medium text-gray-800 mb-3">Informações Atuais</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Formato:</span>
                    <span className="ml-2 font-medium">{selectedVideo.formato_original?.toUpperCase() || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Bitrate:</span>
                    <span className={`ml-2 font-medium ${
                      selectedVideo.current_bitrate > selectedVideo.user_bitrate_limit ? 'text-red-600' : 'text-gray-900'
                    }`}>
                      {selectedVideo.current_bitrate || 'N/A'} kbps
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Tamanho:</span>
                    <span className="ml-2 font-medium">
                      {selectedVideo.tamanho ? formatFileSize(selectedVideo.tamanho) : 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Duração:</span>
                    <span className="ml-2 font-medium">
                      {selectedVideo.duracao ? formatDuration(selectedVideo.duracao) : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Seleção de qualidade */}
              <div className="space-y-4">
                <div className="flex items-center space-x-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={!conversionSettings.use_custom}
                      onChange={() => setConversionSettings(prev => ({ ...prev, use_custom: false }))}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                    />
                    <span className="ml-2 text-sm font-medium text-gray-700">Usar qualidade predefinida</span>
                  </label>
                  
                  <label className="flex items-center">
                    <input
                      type="radio"
                      checked={conversionSettings.use_custom}
                      onChange={() => setConversionSettings(prev => ({ ...prev, use_custom: true }))}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                    />
                    <span className="ml-2 text-sm font-medium text-gray-700">Configuração customizada</span>
                  </label>
                </div>

                {!conversionSettings.use_custom ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      Qualidade de Conversão
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {qualityPresets.map((preset) => (
                        <label key={preset.quality} className="flex items-center p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                          <input
                            type="radio"
                            name="quality"
                            value={preset.quality}
                            checked={conversionSettings.quality === preset.quality}
                            onChange={(e) => setConversionSettings(prev => ({ ...prev, quality: e.target.value }))}
                            disabled={!preset.available}
                            className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                          />
                          <div className="ml-3 flex-1">
                            <div className="flex items-center justify-between">
                              <span className={`font-medium ${preset.available ? 'text-gray-900' : 'text-gray-400'}`}>
                                {preset.label}
                              </span>
                              <span className={`text-sm ${preset.available ? 'text-gray-600' : 'text-red-600'}`}>
                                {preset.bitrate} kbps
                              </span>
                            </div>
                            <p className={`text-xs ${preset.available ? 'text-gray-500' : 'text-red-500'}`}>
                              {preset.description}
                              {!preset.available && ` (Excede limite: ${user?.bitrate || 2500} kbps)`}
                            </p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Bitrate Customizado (kbps)
                      </label>
                      <input
                        type="number"
                        min="500"
                        max={user?.bitrate || 2500}
                        value={conversionSettings.custom_bitrate || ''}
                        onChange={(e) => setConversionSettings(prev => ({ 
                          ...prev, 
                          custom_bitrate: parseInt(e.target.value) || undefined
                        }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Máximo permitido: {user?.bitrate || 2500} kbps
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Resolução Customizada
                      </label>
                      <select
                        value={conversionSettings.custom_resolution || '1920x1080'}
                        onChange={(e) => setConversionSettings(prev => ({ 
                          ...prev, 
                          custom_resolution: e.target.value 
                        }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                      >
                        <option value="1920x1080">1080p (1920x1080)</option>
                        <option value="1280x720">720p (1280x720)</option>
                        <option value="854x480">480p (854x480)</option>
                        <option value="640x360">360p (640x360)</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Estimativa */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">📊 Estimativa da Conversão</h4>
                <div className="text-blue-800 text-sm space-y-1">
                  <p>• Formato final: MP4 (H.264 + AAC)</p>
                  {!conversionSettings.use_custom ? (
                    <>
                      <p>• Qualidade: {getQualityLabel(conversionSettings.quality || 'media')}</p>
                      <p>• Bitrate: {qualityPresets.find(p => p.quality === conversionSettings.quality)?.bitrate || 'N/A'} kbps</p>
                      <p>• Resolução: {qualityPresets.find(p => p.quality === conversionSettings.quality)?.resolution || 'N/A'}</p>
                    </>
                  ) : (
                    <>
                      <p>• Bitrate: {conversionSettings.custom_bitrate || 'N/A'} kbps</p>
                      <p>• Resolução: {conversionSettings.custom_resolution || 'N/A'}</p>
                    </>
                  )}
                  <p>• Tempo estimado: 5-15 minutos (dependendo do tamanho)</p>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => setShowConversionModal(false)}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
              >
                Cancelar
              </button>
              <button
                onClick={startConversion}
                disabled={
                  conversionSettings.use_custom ? 
                    !conversionSettings.custom_bitrate || (conversionSettings.custom_bitrate > (user?.bitrate || 2500)) :
                    !qualityPresets.find(p => p.quality === conversionSettings.quality)?.available
                }
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center"
              >
                <Settings className="h-4 w-4 mr-2" />
                Iniciar Conversão
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal do Player HTML5 */}
      {showPlayerModal && currentVideo && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeVideoPlayer();
            }
          }}
        >
          <div className={`bg-black rounded-lg relative ${
            isFullscreen ? 'w-screen h-screen' : 'max-w-4xl w-full h-[70vh]'
          }`}>
            {/* Controles do Modal */}
            <div className="absolute top-4 right-4 z-20 flex items-center space-x-2">
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="text-white bg-blue-600 hover:bg-blue-700 rounded-full p-3 transition-colors duration-200 shadow-lg"
                title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
              >
                {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
              </button>
              
              <button
                onClick={closeVideoPlayer}
                className="text-white bg-red-600 hover:bg-red-700 rounded-full p-3 transition-colors duration-200 shadow-lg"
                title="Fechar player"
              >
                <X size={20} />
              </button>
            </div>

            {/* Título do Vídeo */}
            <div className="absolute top-4 left-4 z-20 bg-black bg-opacity-60 text-white px-4 py-2 rounded-lg">
              <h3 className="font-medium">{currentVideo.nome}</h3>
              <p className="text-xs opacity-80">
                {currentVideo.formato_original?.toUpperCase()} • 
                {currentVideo.current_bitrate} kbps • 
                {currentVideo.duracao ? formatDuration(currentVideo.duracao) : 'N/A'}
              </p>
            </div>

            {/* Player HTML5 Simples */}
            <div className={`w-full h-full ${isFullscreen ? 'p-0' : 'p-4 pt-16'}`}>
              <video
                src={buildVideoUrl(currentVideo.url)}
                className="w-full h-full object-contain"
                controls
                autoPlay
                preload="metadata"
                onError={(e) => {
                  console.error('Erro no player:', e);
                  toast.error('Erro ao carregar vídeo. Tente abrir em nova aba.');
                }}
              >
                <source src={buildVideoUrl(currentVideo.url)} type="video/mp4" />
                Seu navegador não suporta reprodução de vídeo.
              </video>
            </div>
          </div>
        </div>
      )}

      {/* Informações de ajuda */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-start">
          <AlertCircle className="h-5 w-5 text-blue-600 mr-3 mt-0.5" />
          <div>
            <h3 className="text-blue-900 font-medium mb-2">Sistema de Conversão Avançado</h3>
            <ul className="text-blue-800 text-sm space-y-1">
              <li>• <strong>Todos os vídeos</strong> são listados, independente do formato</li>
              <li>• <strong>Qualidades predefinidas:</strong> Baixa (480p), Média (720p), Alta (1080p), Full HD (1080p+)</li>
              <li>• <strong>Configuração customizada:</strong> Defina bitrate e resolução específicos</li>
              <li>• <strong>Limite respeitado:</strong> Apenas qualidades dentro do seu plano são permitidas</li>
              <li>• <strong>MP4 originais:</strong> Podem ser reconvertidos para diferentes qualidades</li>
              <li>• <strong>Player HTML5:</strong> Visualização direta de todos os vídeos</li>
              <li>• <strong>Conversão inteligente:</strong> Preserva qualidade visual otimizando tamanho</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConversaoVideos;