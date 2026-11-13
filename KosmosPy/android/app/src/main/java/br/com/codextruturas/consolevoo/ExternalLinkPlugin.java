package br.com.codextruturas.consolevoo;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ExternalLink")
public class ExternalLinkPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String value = call.getString("url");
        if (value == null || !(value.startsWith("https://") || value.startsWith("http://"))) {
            call.reject("URL externa inválida.");
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(value));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Não foi possível abrir o link no navegador do aparelho.", error);
        }
    }
}
