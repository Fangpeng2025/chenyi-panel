/**
 * 晨翼Agent - 屏幕投屏模块
 * 使用Electron的desktopCapturer获取屏幕，通过WebSocket或IPC发送给客户端
 */

const { desktopCapturer, screen } = require('electron');

class ScreenStream {
  constructor() {
    this.isStreaming = false;
    this.frameRate = 10; // 帧率
    this.quality = 0.8; // JPEG质量
    this.streamInterval = null;
    this.onFrame = null; // 帧回调
    this.sources = [];
  }

  /**
   * 获取可用的屏幕/窗口源
   */
  async getSources() {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true
      });
      
      this.sources = sources.map(source => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        display_id: source.display_id,
        isScreen: source.id.startsWith('screen:')
      }));
      
      return this.sources;
    } catch (err) {
      console.error('获取屏幕源失败:', err);
      return [];
    }
  }

  /**
   * 获取指定源的详细信息
   */
  async getSourceDetails(sourceId) {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 1920, height: 1080 }
      });
      
      const source = sources.find(s => s.id === sourceId);
      if (!source) {
        return null;
      }

      return {
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        display_id: source.display_id
      };
    } catch (err) {
      console.error('获取源详情失败:', err);
      return null;
    }
  }

  /**
   * 开始屏幕投屏
   * @param {string} sourceId - 屏幕源ID
   * @param {Function} onFrameCallback - 帧数据回调
   */
  async startStreaming(sourceId, onFrameCallback) {
    if (this.isStreaming) {
      await this.stopStreaming();
    }

    this.onFrame = onFrameCallback;
    this.isStreaming = true;

    // 获取全屏截图
    const capture = async () => {
      if (!this.isStreaming) return;

      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: screen.getPrimaryDisplay().workAreaSize,
          preferCurrentTab: false
        });

        const source = sources.find(s => s.id === sourceId) || sources[0];
        if (!source) {
          console.error('未找到屏幕源');
          return;
        }

        // 获取高分辨率缩略图
        const thumbnail = source.thumbnail;
        const size = thumbnail.getSize();

        // 转换为JPEG格式的base64
        const frameData = thumbnail.toDataURL({
          format: 'jpeg',
          quality: this.quality,
          resolution: 'scale'
        });

        // 发送帧数据
        if (this.onFrame) {
          this.onFrame({
            timestamp: Date.now(),
            width: size.width,
            height: size.height,
            data: frameData
          });
        }
      } catch (err) {
        console.error('捕获屏幕失败:', err);
      }
    };

    // 立即捕获一帧
    await capture();

    // 设置定时捕获
    const intervalMs = Math.round(1000 / this.frameRate);
    this.streamInterval = setInterval(capture, intervalMs);

    console.log(`屏幕投屏已启动，帧率: ${this.frameRate}fps`);
    return { success: true };
  }

  /**
   * 停止屏幕投屏
   */
  async stopStreaming() {
    if (this.streamInterval) {
      clearInterval(this.streamInterval);
      this.streamInterval = null;
    }
    
    this.isStreaming = false;
    this.onFrame = null;
    console.log('屏幕投屏已停止');
    return { success: true };
  }

  /**
   * 设置帧率
   */
  setFrameRate(fps) {
    this.frameRate = Math.min(Math.max(fps, 1), 60);
    
    // 如果正在投屏，重启以应用新帧率
    if (this.isStreaming) {
      console.log(`帧率已更新为: ${this.frameRate}fps`);
    }
    
    return this.frameRate;
  }

  /**
   * 设置图像质量
   */
  setQuality(quality) {
    this.quality = Math.min(Math.max(quality, 0.1), 1.0);
    return this.quality;
  }

  /**
   * 获取当前状态
   */
  getStatus() {
    return {
      isStreaming: this.isStreaming,
      frameRate: this.frameRate,
      quality: this.quality
    };
  }

  /**
   * 获取屏幕尺寸信息
   */
  getDisplayInfo() {
    const primaryDisplay = screen.getPrimaryDisplay();
    return {
      width: primaryDisplay.size.width,
      height: primaryDisplay.size.height,
      workArea: primaryDisplay.workArea,
      scaleFactor: primaryDisplay.scaleFactor
    };
  }
}

module.exports = ScreenStream;
