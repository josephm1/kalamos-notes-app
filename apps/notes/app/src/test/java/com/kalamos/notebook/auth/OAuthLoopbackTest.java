package com.kalamos.notebook.auth;
import org.junit.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.Assert.*;
public class OAuthLoopbackTest {
    String request(String redirect,String query) throws Exception {
        URI uri=new URI(redirect);try(Socket s=new Socket("127.0.0.1",uri.getPort())) {
            s.setSoTimeout(5000);s.getOutputStream().write(("GET /auth/callback?"+query+" HTTP/1.1\r\nHost: 127.0.0.1:"+uri.getPort()+"\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            return new String(OpenAiHttp.readBounded(s.getInputStream(),16000),StandardCharsets.UTF_8);
        }
    }
    @Test public void ignoresWrongStateThenAcceptsBoundCallback() throws Exception {
        try(OAuthLoopback loop=new OAuthLoopback("test.app")) {
            var pending=new OAuthProtocol.Attempt("good","nonce","verifier",loop.redirect(),"dynamic_agent_client","","");
            ExecutorService worker=Executors.newSingleThreadExecutor();
            try {
                Future<Map<String,String>> future=worker.submit(()->loop.await(pending));
                assertTrue(request(loop.redirect(),"state=wrong&code=secret-code&client_id=issued-client").contains("400"));
                String html=request(loop.redirect(),"state=good&code=secret-code&client_id=issued-client");
                assertTrue(html.contains("200 OK"));assertFalse(html.contains("secret-code"));assertTrue(html.contains("Cache-Control: no-store"));
                assertEquals("issued-client",future.get(3,TimeUnit.SECONDS).get("client_id"));
            } finally { worker.shutdownNow(); }
        }
    }
    @Test public void closesOnCancellation() throws Exception {
        OAuthLoopback loop=new OAuthLoopback("test.app");ExecutorService worker=Executors.newSingleThreadExecutor();
        try {
            Future<?> future=worker.submit(()->{ try { loop.await(new OAuthProtocol.Attempt("a","b","c",loop.redirect(),"issued-client","",""));throw new AssertionError(); } catch(IOException expected) {} catch(Exception e) {throw new RuntimeException(e);} });
            loop.close();future.get(3,TimeUnit.SECONDS);
        } finally { loop.close();worker.shutdownNow(); }
    }
}
