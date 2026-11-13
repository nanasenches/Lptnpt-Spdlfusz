package br.com.codextruturas.consolevoo;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KmlExporterPlugin.class);
        registerPlugin(ExternalLinkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
