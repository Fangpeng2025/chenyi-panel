# 晨翼Agent v1.0 客户端开发文档

## 一、客户端架构

### 1.1 整体架构

```
┌─────────────────────────────────────────────────────┐
│                   客户端架构                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ 连接管理器  │  │ 指令执行器  │  │ 状态同步器  │ │
│  │ Connection  │  │ Executor    │  │ SyncManager │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ 投屏服务    │  │ 文件同步    │  │ 本地缓存    │ │
│  │ StreamSvc   │  │ FileSync    │  │ Cache       │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
│  ┌─────────────────────────────────────────────────┐│
│  │              Hermes Core (底层能力)              ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

### 1.2 核心模块

| 模块 | 职责 | Android | Electron |
|------|------|---------|----------|
| ConnectionManager | WebSocket连接管理 | OkHttp | 原生WebSocket |
| CommandExecutor | 指令执行引擎 | AccessibilityService | Node.js子进程 |
| StreamService | 投屏推流 | MediaCodec | WebRTC接收 |
| FileSync | 文件同步 | WorkManager | fs.watch |
| CacheManager | 本地缓存 | Room | SQLite |

## 二、WebSocket 连接管理

### 2.1 连接管理器（Android）

```kotlin
class ConnectionManager(private val context: Context) {
    private var webSocket: WebSocket? = null
    private val scope = CoroutineScope(Dispatchers.IO)
    
    fun connect(token: String) {
        val client = OkHttpClient.Builder()
            .pingInterval(30, TimeUnit.SECONDS)
            .build()
        
        val request = Request.Builder()
            .url("wss://cloud.chenyi.com/ws?token=$token")
            .build()
        
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                // 注册设备
                registerDevice()
            }
            
            override fun onMessage(ws: WebSocket, text: String) {
                handleMessage(text)
            }
            
            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                // 断线重连
                scope.launch {
                    delay(calculateBackoff())
                    connect(token)
                }
            }
        })
    }
    
    private var retryCount = 0
    private fun calculateBackoff(): Long {
        val delay = minOf(1000L * (1 shl retryCount), 30000L)
        retryCount++
        return delay
    }
}
```

### 2.2 连接管理器（Electron）

```javascript
// renderer.js
class ConnectionManager {
  constructor() {
    this.ws = null;
    this.retryCount = 0;
  }
  
  connect(token) {
    this.ws = new WebSocket(`wss://cloud.chenyi.com/ws?token=${token}`);
    
    this.ws.onopen = () => {
      this.retryCount = 0;
      this.registerDevice();
    };
    
    this.ws.onmessage = (event) => {
      this.handleMessage(JSON.parse(event.data));
    };
    
    this.ws.onclose = () => {
      const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
      this.retryCount++;
      setTimeout(() => this.connect(token), delay);
    };
  }
  
  send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
}
```
## 三、设备注册流程

### 3.1 设备ID生成

```kotlin
// Android
fun generateDeviceId(): String {
    val androidId = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ANDROID_ID
    )
    return "android_${androidId}"
}

// Electron
function generateDeviceId() {
  const { machineIdSync } = require('node-machine-id');
  return `electron_${machineIdSync()}`;
}
```

### 3.2 设备注册

```kotlin
fun registerDevice() {
    val message = mapOf(
        "type" to "register",
        "data" to mapOf(
            "deviceId" to getDeviceId(),
            "deviceType" to "android",
            "deviceName" to Build.MODEL,
            "capabilities" to listOf("screen_stream", "control", "file_sync")
        )
    )
    webSocket?.send(gson.toJson(message))
}
```

## 四、指令执行引擎

### 4.1 指令处理器（Android）

```kotlin
class CommandExecutor(private val context: Context) {
    private val accessibilityService: MyAccessibilityService? = null
    
    suspend fun execute(command: String, params: JSONObject): Result {
        return when (command) {
            "tap" -> {
                val x = params.getInt("x")
                val y = params.getInt("y")
                accessibilityService?.click(x, y)
                Result.success("点击成功")
            }
            
            "swipe" -> {
                val startX = params.getInt("startX")
                val startY = params.getInt("startY")
                val endX = params.getInt("endX")
                val endY = params.getInt("endY")
                accessibilityService?.swipe(startX, startY, endX, endY)
                Result.success("滑动成功")
            }
            
            "input_text" -> {
                val text = params.getString("text")
                accessibilityService?.inputText(text)
                Result.success("输入成功")
            }
            
            "screenshot" -> {
                val bitmap = takeScreenshot()
                val base64 = bitmapToBase64(bitmap)
                Result.success(base64)
            }
            
            else -> Result.failure("未知指令: $command")
        }
    }
}
```

### 4.2 指令处理器（Electron）

```javascript
class CommandExecutor {
  async execute(command, params) {
    switch (command) {
      case 'screenshot':
        const img = await this.takeScreenshot();
        return { success: true, data: img.toString('base64') };
      
      case 'run_script':
        const result = await this.runScript(params.script);
        return { success: true, output: result };
      
      case 'open_app':
        await this.openApp(params.appName);
        return { success: true };
      
      default:
        return { success: false, error: `未知指令: ${command}` };
    }
  }
  
  async takeScreenshot() {
    const { desktopCapturer } = require('electron');
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources[0].thumbnail.toPNG();
  }
}
```

## 五、投屏功能实现

### 5.1 Android 推流服务

```kotlin
class H264ScreenStreamService : Service() {
    private var mediaProjection: MediaProjection? = null
    private var encoder: MediaCodec? = null
    private var webSocket: WebSocket? = null
    
    fun startStream(webSocketUrl: String) {
        // 1. 初始化 MediaProjection
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val intent = manager.createScreenCaptureIntent()
        // 需要在 Activity 中请求权限
        
        // 2. 初始化 MediaCodec 编码器
        val format = MediaFormat.createVideoFormat("video/avc", 720, 1280)
        format.setInteger(MediaFormat.KEY_BIT_RATE, 2_000_000)
        format.setInteger(MediaFormat.KEY_FRAME_RATE, 30)
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
        
        encoder = MediaCodec.createEncoderByType("video/avc")
        encoder?.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        
        // 3. 开始编码
        encoder?.start()
        
        // 4. 循环读取编码数据并发送
        scope.launch {
            while (isStreaming) {
                val buffer = encoder?.outputBuffers
                val info = BufferInfo()
                val index = encoder?.dequeueOutputBuffer(info, 10000) ?: -1
                
                if (index >= 0) {
                    val data = ByteArray(info.size)
                    buffer?.get(index)?.get(data)
                    webSocket?.send(ByteString.of(*data))
                    encoder?.releaseOutputBuffer(index, false)
                }
            }
        }
    }
}
```

### 5.2 Electron 接收解码

```javascript
class VideoReceiver {
  constructor(canvas) {
    this.canvas = canvas;
    this.decoder = null;
  }
  
  async init() {
    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.canvas.getContext('2d').drawImage(frame, 0, 0);
        frame.close();
      },
      error: (e) => console.error('解码错误:', e)
    });
    
    this.decoder.configure({
      codec: 'avc1.42C01E',
      codedWidth: 720,
      codedHeight: 1280
    });
  }
  
  // WebRTC P2P 接收
  async startReceiving(peerConnection) {
    peerConnection.ontrack = (event) => {
      const receiver = event.receiver;
      // 处理接收到的H264数据
    };
  }
  
  // WebSocket 接收（备用方案）
  onWebSocketMessage(data) {
    const chunk = new EncodedVideoChunk({
      type: 'key', // 或 'delta'
      timestamp: Date.now(),
      data: data
    });
    this.decoder.decode(chunk);
  }
}
```

## 六、本地缓存与离线模式

### 6.1 本地缓存策略

```kotlin
// Android - Room 数据库
@Entity
data class CachedTask(
    @PrimaryKey val id: String,
    val command: String,
    val params: String,
    val createdAt: Long
)

@Dao
interface TaskDao {
    @Query("SELECT * FROM CachedTask WHERE id = :id")
    suspend fun getById(id: String): CachedTask?
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(task: CachedTask)
    
    @Delete
    suspend fun delete(task: CachedTask)
}
```

### 6.2 离线模式

```kotlin
class OfflineManager {
    private val pendingTasks = mutableListOf<CachedTask>()
    
    fun onOffline() {
        // 切换到离线模式
        isOnline = false
    }
    
    fun onOnline() {
        // 恢复在线，同步待处理任务
        isOnline = true
        syncPendingTasks()
    }
    
    fun executeTask(task: Task) {
        if (isOnline) {
            // 在线：发送到云端
            sendToCloud(task)
        } else {
            // 离线：本地执行
            executeLocally(task)
            // 缓存结果，待上线后同步
            cacheResult(task)
        }
    }
}
```

## 七、与 Hermes Core 集成

### 7.1 集成架构

```
┌─────────────────────────────────────────────────────┐
│                   晨翼Agent客户端                    │
│  ┌─────────────────────────────────────────────────┐│
│  │              业务逻辑层                          ││
│  │  (设备控制、投屏、文件同步)                      ││
│  └───────────────────────┬─────────────────────────┘│
│                          │ 调用                      │
│  ┌───────────────────────┴─────────────────────────┐│
│  │              Hermes Core                         ││
│  │  - DroidPilot (手机控制)                        ││
│  │  - Web Browser (网页自动化)                     ││
│  │  - Terminal (命令执行)                          ││
│  │  - File System (文件操作)                       ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

### 7.2 Android 端集成

```kotlin
// 在 MainActivity 中初始化 Hermes
class MainActivity : AppCompatActivity() {
    private lateinit var hermesCore: HermesCore
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // 初始化 Hermes Core
        hermesCore = HermesCore.Builder()
            .setContext(this)
            .setWebSocketUrl("wss://cloud.chenyi.com/ws")
            .build()
        
        // 连接云端
        hermesCore.connect(getToken())
    }
}
```

### 7.3 Electron 端集成

```javascript
// main.js
const { HermesCore } = require('./hermes-core');

const hermes = new HermesCore({
  wsUrl: 'wss://cloud.chenyi.com/ws',
  token: getToken()
});

hermes.on('command', async (cmd) => {
  const result = await hermes.execute(cmd);
  hermes.sendResult(result);
});

hermes.connect();
```

## 八、开发规范

### 8.1 代码规范

- Android: Kotlin + MVVM架构
- Electron: JavaScript + 模块化
- 统一使用 JSON 格式通信
- 所有异步操作使用协程/async-await

### 8.2 错误处理

```kotlin
sealed class Result<out T> {
    data class Success<out T>(val data: T) : Result<T>()
    data class Failure(val error: String) : Result<Nothing>()
}

// 使用
when (val result = executeCommand(cmd)) {
    is Result.Success -> sendResponse(result.data)
    is Result.Failure -> sendError(result.error)
}
```

### 8.3 日志规范

```kotlin
object Logger {
    fun d(tag: String, message: String) {
        Log.d("ChenyiAgent", "[$tag] $message")
    }
    
    fun e(tag: String, error: Throwable) {
        Log.e("ChenyiAgent", "[$tag] ${error.message}", error)
        // 上报错误到云端
        reportError(error)
    }
}
```
