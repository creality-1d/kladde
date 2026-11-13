package org.inknotes.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WebDavHttpPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
