// Adapted from josephm1/LearnHarness-Mobile Android account connection code.
package com.kalamos.notebook.auth;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Listener is loopback-only, bounded, cancellable, and accepts only a state-bound GET callback. */
public final class OAuthLoopback implements AutoCloseable {
    private final ServerSocket server;
    private final String returnScheme;
    private volatile boolean closed;
    public OAuthLoopback(String appPackage) throws IOException {
        returnScheme=appPackage+".chatgpt";
        server=new ServerSocket(); server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"),0)); server.setSoTimeout(1000);
    }
    public String redirect() { return "http://127.0.0.1:"+server.getLocalPort()+"/auth/callback"; }
    public Map<String,String> await(OAuthProtocol.Attempt pending) throws Exception {
        long deadline=System.currentTimeMillis()+300000;
        while(!closed && System.currentTimeMillis()<deadline) {
            try (Socket socket=server.accept()) {
                socket.setSoTimeout(3000);
                try {
                    String request=readLine(socket.getInputStream()); String[] pieces=request.split(" ");
                    if(pieces.length!=3 || !pieces[0].equals("GET")) { respond(socket,400,false); continue; }
                    URI uri=new URI(pieces[1]);
                    if(uri.isAbsolute() || !"/auth/callback".equals(uri.getPath()) || uri.getFragment()!=null) { respond(socket,404,false); continue; }
                    String header; int total=0; boolean host=false;
                    while(!(header=readLine(socket.getInputStream())).isEmpty()) {
                        total+=header.length(); if(total>16000)throw new IOException("Callback headers too large.");
                        if(header.toLowerCase(java.util.Locale.ROOT).startsWith("host:"))host=header.substring(5).trim().equals("127.0.0.1:"+server.getLocalPort());
                    }
                    if(!host) { respond(socket,400,false); continue; }
                    Map<String,String> query=OAuthProtocol.query(uri.getRawQuery());
                    if(!OAuthProtocol.equal(pending.state(),query.get("state"))) { respond(socket,400,false); continue; }
                    try { OAuthProtocol.callbackClient(pending,query); }
                    catch(Exception error) { respond(socket,400,false); throw error; }
                    respond(socket,200,true); return query;
                } catch(java.net.URISyntaxException | IllegalArgumentException e) { respond(socket,400,false); }
            } catch(SocketTimeoutException ignored) { /* poll cancellation, not authentication */ }
        }
        throw new IOException(closed?"ChatGPT sign-in cancelled.":"ChatGPT sign-in timed out. Return to Settings and try again.");
    }
    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream line=new ByteArrayOutputStream(); int c;
        while((c=in.read())!=-1) { if(c=='\n')break; if(c!='\r')line.write(c); if(line.size()>16000)throw new IOException("Callback line too large."); }
        if(c==-1 && line.size()==0)throw new EOFException("Incomplete callback request.");
        return line.toString(StandardCharsets.US_ASCII.name());
    }
    private void respond(Socket socket,int status,boolean accepted) throws IOException {
        String body="<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'><title>Kalamos Notes</title></head><body style='background:white;color:black;font:20px sans-serif;padding:24px'>"
            +"<h1>Kalamos Notes</h1><p>"+(accepted?"Completing your ChatGPT sign-in. Return to Kalamos Notes to see the result.":"This sign-in request was not accepted. Return to Kalamos Notes and try again.")
            +"</p><p><a href='"+returnScheme+"://signin-complete'>Return to Kalamos Notes</a></p></body></html>";
        byte[] bytes=body.getBytes(StandardCharsets.UTF_8);
        String headers="HTTP/1.1 "+status+" "+(status==200?"OK":"Invalid request")+"\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: "+bytes.length+"\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'\r\nConnection: close\r\n\r\n";
        socket.getOutputStream().write(headers.getBytes(StandardCharsets.US_ASCII)); socket.getOutputStream().write(bytes); socket.getOutputStream().flush();
    }
    @Override public void close() { closed=true; try { server.close(); } catch(IOException ignored) {} }
}
