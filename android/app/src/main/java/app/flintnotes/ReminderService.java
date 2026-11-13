package app.flintnotes;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Brings the reminders when the app is closed: keeps one connection to the server's stream (/api/reminders/stream, server-sent
 * events) and shows each message as a notification. A message missed meanwhile (the phone asleep, out of the wifi) comes when
 * the connection is back, by the number of the last one shown. It stays in the foreground, so the system leaves it alone.
 */
public final class ReminderService extends Service {
    private static final String SERVICE_CHANNEL = "connection";
    private static final String REMINDER_CHANNEL = "reminders";
    private static final int SERVICE_NOTIFICATION = 1;

    private Thread reader;
    private volatile boolean stopped;
    private volatile HttpURLConnection current;
    private WifiManager.WifiLock wifi;

    static void start(Context context) {
        Intent intent = new Intent(context, ReminderService.class);
        try {
            context.startForegroundService(intent);
        } catch (RuntimeException ignored) {
            // The system does not let a service start in the foreground from here (the app has not been in front for long);
            // the next time the app is opened it starts.
        }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, ReminderService.class));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        makeChannels();
        showConnection("Напоминания включены");
        if (reader == null || !reader.isAlive()) {
            stopped = false;
            reader = new Thread(this::read, "flint-reminders");
            reader.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopped = true;
        HttpURLConnection connection = current;
        if (connection != null) connection.disconnect();
        if (wifi != null && wifi.isHeld()) wifi.release();
        super.onDestroy();
    }

    private void makeChannels() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel quiet = new NotificationChannel(SERVICE_CHANNEL, "Соединение с сервером", NotificationManager.IMPORTANCE_MIN);
        quiet.setDescription("Постоянное уведомление: пока оно есть, напоминания приходят и при закрытом приложении");
        quiet.setShowBadge(false);
        manager.createNotificationChannel(quiet);
        NotificationChannel reminders = new NotificationChannel(REMINDER_CHANNEL, "Напоминания", NotificationManager.IMPORTANCE_HIGH);
        reminders.enableVibration(true);
        manager.createNotificationChannel(reminders);
    }

    private PendingIntent openApp(boolean change) {
        Intent intent = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (change) intent.putExtra("change", true);
        return PendingIntent.getActivity(this, change ? 1 : 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void showConnection(String text) {
        Notification.Builder builder = new Notification.Builder(this, SERVICE_CHANNEL)
                .setSmallIcon(R.drawable.ic_bell)
                .setContentTitle("FlintNotes")
                .setContentText(text)
                .setOngoing(true)
                .setContentIntent(openApp(false))
                .addAction(new Notification.Action.Builder(null, "Сменить сервер", openApp(true)).build());
        Notification notification = builder.build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(SERVICE_NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(SERVICE_NOTIFICATION, notification);
    }

    private void remind(long id, String title, String body) {
        Notification notification = new Notification.Builder(this, REMINDER_CHANNEL)
                .setSmallIcon(R.drawable.ic_bell)
                .setContentTitle(title)
                .setContentText(body.split("\n")[0])
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setCategory(Notification.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(openApp(false))
                .build();
        getSystemService(NotificationManager.class).notify((int) (2 + id % 1_000_000), notification);
    }

    /** One connection after another, until the service is stopped; a pause that grows (2 s to 30 s) between failures. */
    private void read() {
        WifiManager manager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        // The radio stays awake with the screen off: the server's word (a message, or its ping) would otherwise wait for the next beacon.
        wifi = manager.createWifiLock(Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF, "flint:reminders");
        wifi.setReferenceCounted(false);
        wifi.acquire();
        int failures = 0;
        while (!stopped) {
            Link link = Link.saved(this);
            if (link == null) break;
            boolean heard = false;
            try {
                heard = listen(link);
            } catch (java.io.IOException ignored) {
                // The server is off, the network is gone, or the line was cut: the same as any other end of a connection.
            } catch (RuntimeException ignored) {
                // A line the server sent that this cannot read; the connection is started again.
            }
            if (stopped) break;
            failures = heard ? 0 : failures + 1;
            if (failures == 3) showConnection("Нет связи с сервером");
            if (heard && failures == 0) showConnection("Напоминания включены");
            try {
                Thread.sleep(Math.min(30_000, 2_000L << Math.min(failures, 4)));
            } catch (InterruptedException e) {
                break;
            }
        }
    }

    /** One connection. True if the server answered as it should (so a later cut is not a failure to count). */
    private boolean listen(Link link) throws java.io.IOException {
        long last = Link.lastMessage(this);
        URL url = new URL(link.origin + "/api/reminders/stream?since=" + (last >= 0 ? String.valueOf(last) : "latest"));
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        current = connection;
        try {
            connection.setConnectTimeout(10_000);
            // The server says something every 20 s; silence for a minute means the line is dead.
            connection.setReadTimeout(60_000);
            connection.setRequestProperty("Accept", "text/event-stream");
            // Either key, as the server tells which it is: the one the page's cookie holds.
            connection.setRequestProperty("Cookie", "flint-key=" + link.key + "; flint-shell=" + link.key);
            int status = connection.getResponseCode();
            if (status == 401) {
                showConnection("Ключ не подошёл: откройте приложение и вставьте новую ссылку");
                return false;
            }
            if (status != 200) return false;
            BufferedReader in = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8));
            String event = "message";
            StringBuilder data = new StringBuilder();
            String line;
            while (!stopped && (line = in.readLine()) != null) {
                if (line.isEmpty()) {
                    if ("reminder".equals(event) && data.length() > 0) deliver(data.toString());
                    else if ("hello".equals(event) && data.length() > 0) learn(data.toString());
                    event = "message";
                    data.setLength(0);
                } else if (line.startsWith("event:")) {
                    event = line.substring(6).trim();
                } else if (line.startsWith("data:")) {
                    if (data.length() > 0) data.append('\n');
                    data.append(line.substring(5).trim());
                }
            }
            return true;
        } finally {
            connection.disconnect();
            current = null;
        }
    }

    /** A new phone is told where the server's messages stand: what it misses from now on is asked for by that number. */
    private void learn(String json) {
        try {
            if (Link.lastMessage(this) < 0) Link.setLastMessage(this, new JSONObject(json).getLong("latest"));
        } catch (org.json.JSONException ignored) {
            // Not a word of ours.
        }
    }

    private void deliver(String json) {
        try {
            JSONObject message = new JSONObject(json);
            long id = message.getLong("id");
            remind(id, message.getString("title"), message.getString("body"));
            Link.setLastMessage(this, id);
        } catch (org.json.JSONException ignored) {
            // Not a message of ours.
        }
    }
}
