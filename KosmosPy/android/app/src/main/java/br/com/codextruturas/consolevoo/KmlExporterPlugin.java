package br.com.codextruturas.consolevoo;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "KmlExporter")
public class KmlExporterPlugin extends Plugin {
    private static final String KML_MIME_TYPE = "application/vnd.google-earth.kml+xml";

    @PluginMethod
    public void open(PluginCall call) {
        String content = call.getString("content");
        String requestedFileName = call.getString("fileName", "trajetoria.kml");

        if (content == null || content.trim().isEmpty()) {
            call.reject("O conteúdo KML está vazio.");
            return;
        }

        String fileName = requestedFileName.replaceAll("[^A-Za-z0-9._-]", "_");
        if (!fileName.toLowerCase().endsWith(".kml")) {
            fileName += ".kml";
        }

        try {
            File exportDirectory = new File(getContext().getCacheDir(), "kml");
            if (!exportDirectory.exists() && !exportDirectory.mkdirs()) {
                throw new IOException("Não foi possível preparar a pasta de exportação.");
            }

            File file = new File(exportDirectory, fileName);
            try (OutputStreamWriter writer = new OutputStreamWriter(
                    new FileOutputStream(file), StandardCharsets.UTF_8)) {
                writer.write(content);
            }

            Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file
            );
            Intent viewIntent = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, KML_MIME_TYPE)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            getActivity().startActivity(Intent.createChooser(viewIntent, "Abrir trajetória KML"));
            JSObject result = new JSObject();
            result.put("fileName", fileName);
            call.resolve(result);
        } catch (ActivityNotFoundException error) {
            call.reject("Nenhum aplicativo compatível com KML foi encontrado.", error);
        } catch (IOException error) {
            call.reject("Não foi possível criar o arquivo KML.", error);
        }
    }
}
