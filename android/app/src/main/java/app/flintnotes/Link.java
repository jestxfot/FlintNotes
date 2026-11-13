package app.flintnotes;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

/** The server this phone is the window of: its address and key (the link `flintnotes pair --phone` prints), kept in the app's own storage. */
final class Link {
    final String origin;
    final String key;

    private Link(String origin, String key) {
        this.origin = origin;
        this.key = key;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("flint", Context.MODE_PRIVATE);
    }

    /** The saved server, or null if none was set up. */
    static Link saved(Context context) {
        SharedPreferences p = prefs(context);
        String origin = p.getString("origin", "");
        String key = p.getString("key", "");
        return origin.isEmpty() || key.isEmpty() ? null : new Link(origin, key);
    }

    static void save(Context context, Link link) {
        // A new server (or a new key) starts its messages from now on.
        prefs(context).edit().putString("origin", link.origin).putString("key", link.key).putString("last", "").putLong("message", -1).apply();
    }

    static String lastPage(Context context) {
        return prefs(context).getString("last", "");
    }

    static void setLastPage(Context context, String url) {
        prefs(context).edit().putString("last", url).apply();
    }

    /** The number of the last reminder shown; -1 while the server has not yet said where its messages stand (then only what comes from now on is asked for). */
    static long lastMessage(Context context) {
        return prefs(context).getLong("message", -1);
    }

    static void setLastMessage(Context context, long id) {
        prefs(context).edit().putLong("message", id).apply();
    }

    static boolean asked(Context context, String what) {
        return prefs(context).getBoolean("asked-" + what, false);
    }

    static void setAsked(Context context, String what) {
        prefs(context).edit().putBoolean("asked-" + what, true).apply();
    }

    /** The address that puts the key into a cookie and goes to the notes. */
    String enter() {
        return origin + "/?key=" + Uri.encode(key);
    }

    /** What was typed or pasted: the link of `flintnotes pair --phone`. The answer is a Link, or a text saying what is wrong. */
    static Object parse(String text) {
        String typed = text == null ? "" : text.trim();
        if (typed.isEmpty()) return "Вставьте ссылку, которую показывает команда flintnotes pair --phone на сервере";
        if (!typed.matches("(?i)^[a-z][a-z0-9+.-]*://.*")) typed = "http://" + typed;
        Uri uri = Uri.parse(typed);
        String scheme = uri.getScheme();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) return "Адрес должен начинаться с http:// или https://";
        String host = uri.getHost();
        if (host == null || host.isEmpty()) return "В адресе нет имени или номера сервера";
        String key = uri.getQueryParameter("key");
        if (key == null || key.trim().isEmpty()) return "В ссылке нет ключа: на сервере выполните flintnotes pair --phone и вставьте ссылку целиком";
        String origin = scheme.toLowerCase() + "://" + host + (uri.getPort() >= 0 ? ":" + uri.getPort() : "");
        return new Link(origin, key.trim());
    }
}
