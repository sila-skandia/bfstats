package io.bfstats.sidecar.app

import android.annotation.SuppressLint
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import io.bfstats.sidecar.viewerUrl

/**
 * The game page in a fullscreen WebView, on play.bfstats.io with the
 * sidecar's socket in the query (as the tray app opens it in a browser).
 * Back asks the page to go back first; leaving the join is the server
 * list's Leave, or the game screen leaving the foreground.
 */
class PlayActivity : ComponentActivity() {
  private lateinit var web: WebView

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    WindowInsetsControllerCompat(window, window.decorView).apply {
      hide(WindowInsetsCompat.Type.systemBars())
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    // chrome://inspect on a debug build.
    if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
    web = WebView(this).apply {
      setBackgroundColor(0xff000000.toInt())
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      settings.mediaPlaybackRequiresUserGesture = false
      settings.cacheMode = WebSettings.LOAD_DEFAULT
      settings.loadWithOverviewMode = true
      settings.useWideViewPort = true
      // The page is https and the socket ws://127.0.0.1; loopback is a secure
      // context, but older WebViews still class it as mixed content.
      settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
      webViewClient = WebViewClient()
      webChromeClient = object : WebChromeClient() {
        override fun onConsoleMessage(m: ConsoleMessage): Boolean {
          if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) SidecarService.log("page: ${m.message()}")
          return true
        }
      }
    }
    setContentView(web)

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else finish() }
    })

    val join = SidecarService.state.value
    val port = join.wsPort
    if (savedInstanceState != null) web.restoreState(savedInstanceState)
    else if (port > 0) web.loadUrl(viewerUrl(port, serverName = join.serverName))
    else finish()
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    web.saveState(outState)
  }

  override fun onResume() { super.onResume(); web.onResume() }
  override fun onPause() { web.onPause(); super.onPause() }

  /** Home, another app or the screen going off: leave the server, as closing
   *  the game does. Nothing plays in the background (no foreground service),
   *  and a WebView left running would keep the round's sound going. A rotation
   *  is not a leave. */
  override fun onStop() {
    super.onStop()
    if (!isChangingConfigurations) {
      SidecarService.leave(this)
      finish()
    }
  }

  override fun onDestroy() {
    web.destroy()
    super.onDestroy()
  }
}
