package com.mathlore.app

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.*
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.io.IOException

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    // Supabase storage prefix — all requests to this URL are served from assets/
    private val MEDIA_PREFIX =
        "https://mklrocckfuoymqvunsmr.supabase.co/storage/v1/object/public/mathlore-assets/"
    private val ASSETS_DIR = "mathlore-assets"

    // Server URL — replace with your actual production domain
    private val SERVER_URL = "https://mathlore.onrender.com"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = false
            // Разрешаем загрузку изображений
            loadsImagesAutomatically = true
        }

        webView.webViewClient = object : WebViewClient() {

            // B3: перехватываем запросы к Supabase — отдаём из assets APK
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val url = request.url.toString()
                if (url.startsWith(MEDIA_PREFIX)) {
                    val filename = url.removePrefix(MEDIA_PREFIX).substringBefore("?")
                    val mimeType = when {
                        filename.endsWith(".jpg", ignoreCase = true) ||
                        filename.endsWith(".jpeg", ignoreCase = true) -> "image/jpeg"
                        filename.endsWith(".png", ignoreCase = true) -> "image/png"
                        filename.endsWith(".webp", ignoreCase = true) -> "image/webp"
                        filename.endsWith(".mp3", ignoreCase = true) -> "audio/mpeg"
                        filename.endsWith(".ogg", ignoreCase = true) -> "audio/ogg"
                        else -> return super.shouldInterceptRequest(view, request)
                    }
                    return try {
                        val stream = assets.open("$ASSETS_DIR/$filename")
                        WebResourceResponse(mimeType, "UTF-8", stream)
                    } catch (e: IOException) {
                        super.shouldInterceptRequest(view, request)
                    }
                }
                // Перехватываем статические картинки с сервера (map.webp и др.)
                if (url.startsWith("$SERVER_URL/")) {
                    val filename = url.removePrefix("$SERVER_URL/").substringBefore("?")
                    val mimeType = when {
                        filename.endsWith(".webp", ignoreCase = true) -> "image/webp"
                        filename.endsWith(".jpg", ignoreCase = true) ||
                        filename.endsWith(".jpeg", ignoreCase = true) -> "image/jpeg"
                        filename.endsWith(".png", ignoreCase = true) -> "image/png"
                        else -> return super.shouldInterceptRequest(view, request)
                    }
                    return try {
                        val stream = assets.open("$ASSETS_DIR/$filename")
                        WebResourceResponse(mimeType, "UTF-8", stream)
                    } catch (e: IOException) {
                        super.shouldInterceptRequest(view, request)
                    }
                }
                return super.shouldInterceptRequest(view, request)
            }
        }

        // B5: убираем адресную строку — используем полноэкранный WebView без UI браузера
        webView.webChromeClient = object : WebChromeClient() {

            // Разрешение камеры для фотографирования заданий
            override fun onPermissionRequest(request: PermissionRequest) {
                if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                    if (ContextCompat.checkSelfPermission(
                            this@MainActivity,
                            android.Manifest.permission.CAMERA
                        ) == PackageManager.PERMISSION_GRANTED
                    ) {
                        request.grant(request.resources)
                    } else {
                        ActivityCompat.requestPermissions(
                            this@MainActivity,
                            arrayOf(android.Manifest.permission.CAMERA),
                            REQUEST_CAMERA
                        )
                        request.deny()
                    }
                } else {
                    request.deny()
                }
            }

            // Выбор файла / съёмка для отправки фото задания
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                val intent = fileChooserParams.createIntent()
                return try {
                    startActivityForResult(intent, REQUEST_FILE_CHOOSER)
                    true
                } catch (e: Exception) {
                    this@MainActivity.filePathCallback = null
                    Toast.makeText(this@MainActivity, "Не удалось открыть галерею", Toast.LENGTH_SHORT).show()
                    false
                }
            }
        }

        webView.loadUrl("$SERVER_URL/app")
    }

    // B6: кнопка "назад" — уходим назад в WebView или показываем подтверждение выхода
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            AlertDialog.Builder(this)
                .setMessage(getString(R.string.exit_confirm))
                .setPositiveButton(getString(R.string.yes)) { _, _ -> finish() }
                .setNegativeButton(getString(R.string.no), null)
                .show()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        if (requestCode == REQUEST_FILE_CHOOSER) {
            filePathCallback?.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            )
            filePathCallback = null
        } else {
            super.onActivityResult(requestCode, resultCode, data)
        }
    }

    companion object {
        private const val REQUEST_CAMERA = 100
        private const val REQUEST_FILE_CHOOSER = 101
    }
}
