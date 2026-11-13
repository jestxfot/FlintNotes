package app.flintnotes;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * FlintNotes on the phone: only a window onto the server, like the Windows app. The page is the server's own (the notes, the search,
 * the index all live there), so it is always the same build as the server. This activity asks for the link once, shows the page, and
 * says in words when the server cannot be reached; the reminders come through ReminderService.
 */
public final class MainActivity extends Activity {
    private static final int FILE = 1;
    private static final int NOTIFICATIONS = 2;
    private static final long[] PAUSES = {2_000, 4_000, 8_000, 16_000, 30_000};

    private final Handler handler = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private LinearLayout connect;
    private LinearLayout offline;
    private EditText field;
    private TextView connectProblem;
    private TextView offlineWhy;
    private ValueCallback<Uri[]> chooser;
    /** The page of this load did not come: what the page finishing says is the browser's error page, not the notes. */
    private boolean failed;
    private boolean triedKey;
    private int retries;
    private Runnable retry;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        build();
        if (!takeIntent(getIntent())) start();
        askPermissions();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        takeIntent(intent);
    }

    /** A link of flintnotes://connect?link=... sets the server up; the notification's «Сменить сервер» asks for a new one. */
    private boolean takeIntent(Intent intent) {
        if (intent == null) return false;
        Uri data = intent.getData();
        if (data != null && "flintnotes".equals(data.getScheme())) {
            String text = data.getQueryParameter("link");
            if (text != null) {
                connectWith(text);
                return true;
            }
        }
        if (intent.getBooleanExtra("change", false)) {
            intent.removeExtra("change");
            showConnect(null);
            return true;
        }
        return false;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView text(String words, int size, int color) {
        TextView view = new TextView(this);
        view.setText(words);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setPadding(0, dp(6), 0, dp(6));
        return view;
    }

    private Button button(String label, View.OnClickListener click) {
        Button view = new Button(this);
        view.setText(label);
        view.setAllCaps(false);
        view.setOnClickListener(click);
        return view;
    }

    private LinearLayout panel() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_VERTICAL);
        box.setPadding(dp(24), dp(24), dp(24), dp(24));
        box.setBackgroundColor(Color.parseColor("#1e1e1e"));
        box.setVisibility(View.GONE);
        return box;
    }

    private void build() {
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#1e1e1e"));
        // The page draws under the bars and keeps clear of them itself (env(safe-area-inset-*), the bars it is told of); what it
        // cannot know is the keyboard, so the page is lifted by that. The panels of this app (the link, no connection) keep clear of the bars.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int left;
            int top;
            int right;
            int bottom;
            int keyboard;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                left = bars.left;
                top = bars.top;
                right = bars.right;
                bottom = bars.bottom;
                keyboard = ime.bottom;
            } else {
                left = insets.getSystemWindowInsetLeft();
                top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight();
                bottom = insets.getSystemWindowInsetBottom();
                keyboard = 0;
            }
            FrameLayout.LayoutParams page = (FrameLayout.LayoutParams) web.getLayoutParams();
            if (page.bottomMargin != keyboard) {
                page.bottomMargin = keyboard;
                web.setLayoutParams(page);
            }
            connect.setPadding(left + dp(24), top + dp(24), right + dp(24), Math.max(bottom, keyboard) + dp(24));
            offline.setPadding(left + dp(24), top + dp(24), right + dp(24), bottom + dp(24));
            return insets;
        });

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#1e1e1e"));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        // The notes' own sizes: the phone's "font size" would make every line of the page larger on top of the page's own scale.
        settings.setTextZoom(100);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, agent, disposition, mime, length) -> {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
            request.setMimeType(mime);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, disposition, mime));
            ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(request);
        });
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        connect = panel();
        connect.addView(text("FlintNotes", 28, Color.WHITE));
        connect.addView(text("Приложение — окно к вашему серверу заметок. На компьютере с сервером выполните flintnotes pair --phone, скопируйте ссылку (http://…:4620/?key=…) и вставьте сюда.", 15, Color.parseColor("#bbbbbb")));
        field = new EditText(this);
        field.setHint("http://192.168.1.50:4620/?key=…");
        field.setHintTextColor(Color.parseColor("#777777"));
        field.setTextColor(Color.WHITE);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        field.setSingleLine(false);
        connect.addView(field);
        connectProblem = text("", 14, Color.parseColor("#ff7b72"));
        connect.addView(connectProblem);
        connect.addView(button("Вставить из буфера", v -> {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = clipboard.getPrimaryClip();
            if (clip != null && clip.getItemCount() > 0) field.setText(clip.getItemAt(0).coerceToText(this));
        }));
        connect.addView(button("Подключиться", v -> connectWith(field.getText().toString())));
        root.addView(connect, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        offline = panel();
        offline.addView(text("Нет связи с сервером", 24, Color.WHITE));
        offlineWhy = text("", 15, Color.parseColor("#bbbbbb"));
        offline.addView(offlineWhy);
        offline.addView(button("Повторить", v -> reload()));
        offline.addView(button("Сменить сервер", v -> showConnect(null)));
        root.addView(offline, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
    }

    // ---- what is on the screen

    private void showWeb() {
        connect.setVisibility(View.GONE);
        offline.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
    }

    private void showConnect(String problem) {
        cancelRetry();
        Link saved = Link.saved(this);
        field.setText(saved == null ? "" : saved.origin + "/?key=");
        connectProblem.setText(problem == null ? "" : problem);
        web.setVisibility(View.GONE);
        offline.setVisibility(View.GONE);
        connect.setVisibility(View.VISIBLE);
    }

    private void showOffline(String why) {
        offlineWhy.setText(why + "\n\nПовторяю сам: " + (retries < PAUSES.length ? PAUSES[retries] / 1000 : PAUSES[PAUSES.length - 1] / 1000) + " с.");
        web.setVisibility(View.GONE);
        connect.setVisibility(View.GONE);
        offline.setVisibility(View.VISIBLE);
        cancelRetry();
        retry = this::reload;
        handler.postDelayed(retry, PAUSES[Math.min(retries, PAUSES.length - 1)]);
        retries++;
    }

    private void cancelRetry() {
        if (retry != null) handler.removeCallbacks(retry);
        retry = null;
    }

    // ---- connecting

    private void connectWith(String text) {
        Object parsed = Link.parse(text);
        if (parsed instanceof String) {
            showConnect((String) parsed);
            return;
        }
        Link.save(this, (Link) parsed);
        triedKey = false;
        retries = 0;
        CookieManager.getInstance().removeAllCookies(null);
        ReminderService.start(this);
        showWeb();
        web.loadUrl(((Link) parsed).enter());
    }

    /** The saved server: straight to the page that was open, if the key's cookie is still there; else in with the key. */
    private void start() {
        Link link = Link.saved(this);
        if (link == null) {
            showConnect(null);
            return;
        }
        ReminderService.start(this);
        showWeb();
        String cookie = CookieManager.getInstance().getCookie(link.origin);
        String last = Link.lastPage(this);
        if (cookie != null && cookie.contains("flint-")) web.loadUrl(last.startsWith(link.origin) ? last : link.origin + "/");
        else web.loadUrl(link.enter());
    }

    private void reload() {
        cancelRetry();
        Link link = Link.saved(this);
        if (link == null) {
            showConnect(null);
            return;
        }
        showWeb();
        web.loadUrl(link.origin + "/");
    }

    private void askPermissions() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATIONS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        // Once the notifications are allowed, the system is asked not to put the connection to sleep (asked once).
        if (code == NOTIFICATIONS && Link.saved(this) != null && !Link.asked(this, "battery")) askBattery();
    }

    private void askBattery() {
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (power.isIgnoringBatteryOptimizations(getPackageName())) return;
        Link.setAsked(this, "battery");
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
        } catch (RuntimeException ignored) {
            // No such screen on this phone.
        }
    }

    // ---- the page

    private boolean sameServer(String url) {
        Link link = Link.saved(this);
        return link != null && url != null && (url.equals(link.origin) || url.startsWith(link.origin + "/"));
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (sameServer(request.getUrl().toString())) return false;
            // A link out of the notes opens in the phone's browser; the window stays on the server.
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
            } catch (RuntimeException ignored) {
                // Nothing on the phone opens it.
            }
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap icon) {
            failed = false;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            failed = true;
            showOffline(error.getDescription().toString());
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (!request.isForMainFrame() || response.getStatusCode() != 401) return;
            failed = true;
            Link link = Link.saved(MainActivity.this);
            if (link != null && !triedKey) {
                // The cookie is gone or old: once more in with the key; if that is refused too, the key is not the server's.
                triedKey = true;
                view.loadUrl(link.enter());
            } else {
                triedKey = false;
                showConnect("Сервер не принял ключ. Выполните на нём flintnotes pair --phone и вставьте новую ссылку.");
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (failed || !sameServer(url)) return;
            triedKey = false;
            retries = 0;
            CookieManager.getInstance().flush();
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean reload) {
            // The notes change the address without loading a page: the one open is kept, to come back to it.
            if (!failed && sameServer(url)) Link.setLastPage(MainActivity.this, url);
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (chooser != null) chooser.onReceiveValue(null);
            chooser = callback;
            try {
                startActivityForResult(params.createIntent(), FILE);
            } catch (RuntimeException e) {
                chooser = null;
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == FILE && chooser != null) {
            chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            chooser = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (connect.getVisibility() == View.VISIBLE && Link.saved(this) != null) showWeb();
        else if (web.getVisibility() == View.VISIBLE && web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        if (Link.saved(this) != null) ReminderService.start(this);
    }

    @Override
    protected void onPause() {
        web.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        cancelRetry();
        web.destroy();
        super.onDestroy();
    }
}
