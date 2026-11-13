package org.inknotes.app;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * HTTP for Nextcloud WebDAV. Capacitor's HTTP layer uses HttpURLConnection,
 * which rejects WebDAV methods such as MKCOL and PROPFIND; OkHttp accepts any method.
 */
@CapacitorPlugin(name = "WebDavHttp")
public class WebDavHttpPlugin extends Plugin {
    private final OkHttpClient client = new OkHttpClient.Builder().readTimeout(60, TimeUnit.SECONDS).build();

    @PluginMethod
    public void request(PluginCall call) {
        String url = call.getString("url");
        String method = call.getString("method", "GET");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("unsupported URL");
            return;
        }
        String bodyBase64 = call.getString("bodyBase64");
        JSObject headers = call.getObject("headers", new JSObject());
        new Thread(() -> {
            try {
                Request.Builder builder = new Request.Builder().url(url);
                Iterator<String> keys = headers.keys();
                String contentType = "application/octet-stream";
                while (keys.hasNext()) {
                    String key = keys.next();
                    String value = headers.getString(key);
                    if (key.equalsIgnoreCase("content-type")) contentType = value;
                    builder.header(key, value);
                }
                RequestBody body = bodyBase64 == null
                    ? (method.equals("GET") || method.equals("HEAD") ? null : RequestBody.create(new byte[0], null))
                    : RequestBody.create(Base64.decode(bodyBase64, Base64.NO_WRAP), MediaType.parse(contentType));
                try (Response response = client.newCall(builder.method(method, body).build()).execute()) {
                    JSObject result = new JSObject();
                    result.put("status", response.code());
                    result.put("statusText", response.message());
                    JSArray pairs = new JSArray();
                    for (String name : response.headers().names()) {
                        JSArray pair = new JSArray();
                        pair.put(name);
                        pair.put(response.header(name));
                        pairs.put(pair);
                    }
                    result.put("headers", pairs);
                    byte[] bytes = response.body() == null ? new byte[0] : response.body().bytes();
                    result.put("bodyBase64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                    call.resolve(result);
                }
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        }).start();
    }
}
