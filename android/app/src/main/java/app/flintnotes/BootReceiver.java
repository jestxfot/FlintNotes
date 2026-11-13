package app.flintnotes;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After the phone starts (or the app is updated) the connection that brings the reminders comes back, with no need to open the app. */
public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Link.saved(context) != null) ReminderService.start(context);
    }
}
