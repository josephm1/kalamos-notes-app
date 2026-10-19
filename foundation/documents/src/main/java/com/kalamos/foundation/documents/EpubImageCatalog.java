package com.kalamos.foundation.documents;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import java.io.File;
import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.LinkedHashSet;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** Local, inert EPUB image provenance. Caption text is source evidence, never instructions. */
public final class EpubImageCatalog {
    private EpubImageCatalog() {}
    public static final int MAX_IMAGES = 32;
    public static final int MAX_IMAGE_BYTES = 10 * 1024 * 1024;
    private static final int MAX_PAGE_BYTES = 2 * 1024 * 1024;
    private static final int MAX_TOTAL_PAGE_BYTES = 16 * 1024 * 1024;

    public static final class Image {
        public final String entry, caption, sourcePage, locator, captionMethod;
        Image(String entry, String caption, String sourcePage, String locator, String method) {
            this.entry = entry; this.caption = caption; this.sourcePage = sourcePage;
            this.locator = locator; this.captionMethod = method;
        }
    }

    /** Resolve archive paths, not basenames: identically named files may be different figures. */
    public static String resolve(String page, String src) {
        try {
            URI relative = new URI(src.trim());
            if (relative.isAbsolute() || relative.getAuthority() != null || src.startsWith("/")) return null;
            URI resolved = new URI("epub", null, "/" + page, null).resolve(relative).normalize();
            String path = resolved.getPath();
            if (path == null || !path.startsWith("/") || path.contains("/../") || path.startsWith("/..")) return null;
            return path.substring(1);
        } catch (Exception ignored) { return null; }
    }

    private static String clean(String text) { return text.replaceAll("[\\s\\u00a0]+", " ").trim(); }
    private static boolean boundedCaption(Element node) {
        return node != null && !node.text().trim().isEmpty() && node.text().length() <= 1200
                && node.select("img, svg, script, table").isEmpty();
    }
    private static boolean captionLike(Element node) {
        if (!boundedCaption(node)) return false;
        String text = clean(node.text());
        if (node.normalName().equals("figcaption") || node.attr("role").equals("caption")) return true;
        if (node.className().toLowerCase(Locale.ROOT).matches(".*(?:caption|figure-caption|illustration-caption).*")) return true;
        // Numbered, wholly emphasized captions survive converters with opaque class names.
        // A nearby ordinary body paragraph is not automatically promoted to a caption.
        List<Element> visible = new ArrayList<>();
        for (Element child : node.children()) if (!clean(child.text()).isEmpty()) visible.add(child);
        return text.matches("(?s)^(?:(?:Figure|Fig\\.|Plate|Map)\\s+)?\\d+[. :].*")
                && visible.size() == 1
                && Arrays.asList("strong", "b", "em", "i").contains(visible.get(0).normalName())
                && clean(visible.get(0).text()).equals(text);
    }
    private static Image result(String entry, String page, Element node, String method) {
        return new Image(entry, clean(node.text()), page, node.cssSelector(), method);
    }

    public static List<Image> describePage(String page, String html) {
        return describePage(page, html, null);
    }

    private static List<Image> describePage(String page, String html, Set<String> selected) {
        Document doc = Jsoup.parse(html); // Parses a string only; does not fetch URLs/entities/assets.
        List<Image> rows = new ArrayList<>();
        for (Element image : doc.select("img[src]")) {
            String entry = resolve(page, image.attr("src"));
            if (entry == null || selected != null && !selected.contains(entry)) continue;
            Image description = null;
            String[] labels = image.attr("aria-describedby").trim().split("\\s+");
            for (String id : labels) {
                Element label = id.isEmpty() ? null : doc.getElementById(id);
                if (boundedCaption(label)) { description = result(entry, page, label, "described-by"); break; }
            }
            Element figure = image.closest("figure");
            if (description == null && figure != null && figure.select("img").size() == 1) {
                Element caption = figure.selectFirst("figcaption");
                if (boundedCaption(caption)) description = result(entry, page, caption, "figcaption");
            }
            if (description == null) {
                Element container = image;
                // Ascend through an image-only wrapper, stopping before surrounding prose/images.
                while (container.parent() != null && !container.parent().normalName().equals("body")
                        && clean(container.parent().text()).isEmpty() && container.parent().select("img").size() == 1) container = container.parent();
                Element next = container.nextElementSibling();
                for (int skipped = 0; next != null && clean(next.text()).isEmpty() && next.select("img,svg").isEmpty() && skipped < 4; skipped++) next = next.nextElementSibling();
                boolean sharedFigureCaption = figure != null && figure.select("img").size() > 1
                        && next != null && next.normalName().equals("figcaption");
                if (!sharedFigureCaption && captionLike(next)) description = result(entry, page, next, "adjacent-caption");
            }
            if (description == null) {
                String alt = clean(image.attr("alt"));
                if (alt.length() >= 12 && alt.length() <= 1200
                        && !alt.toLowerCase(Locale.ROOT).matches("(?:image|illustration|figure|photo|picture)(?:\\s*\\d+)?")) {
                    description = new Image(entry, alt, page, image.cssSelector(), "source-alt");
                }
            }
            rows.add(description != null ? description : new Image(entry, "", page, image.cssSelector(), "unidentified"));
        }
        return rows;
    }

    public static List<Image> read(File epub) throws IOException {
        Map<String, Image> descriptions = new LinkedHashMap<>();
        List<Image> result = new ArrayList<>();
        try (ZipFile zip = new ZipFile(epub)) {
            // Decide the existing bounded catalog first. Caption discovery for
            // images outside it cannot affect the result and can be expensive
            // in converted books containing hundreds of figures on one page.
            Set<String> selected = new LinkedHashSet<>();
            var candidates = zip.entries();
            while (candidates.hasMoreElements() && selected.size() < MAX_IMAGES) {
                ZipEntry image = candidates.nextElement();
                String name = image.getName();
                if (image.isDirectory() || image.getSize() < 5000 || image.getSize() > MAX_IMAGE_BYTES
                        || !name.matches("(?i)^(?:[a-z0-9_-]+/)*[a-z0-9_-][a-z0-9._-]*\\.(?:png|jpe?g|webp)$")
                        || name.toLowerCase(Locale.ROOT).contains("cover")) continue;
                selected.add(name);
            }
            if (selected.isEmpty()) return result;
            int total = 0;
            var entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry page = entries.nextElement();
                String lower = page.getName().toLowerCase(Locale.ROOT);
                if (page.isDirectory() || !(lower.endsWith(".html") || lower.endsWith(".xhtml"))
                        || page.getSize() < 1 || page.getSize() > MAX_PAGE_BYTES || total + page.getSize() > MAX_TOTAL_PAGE_BYTES) continue;
                byte[] bytes;
                try (var input = zip.getInputStream(page); var output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while (output.size() <= MAX_PAGE_BYTES && (count = input.read(buffer, 0, Math.min(buffer.length, MAX_PAGE_BYTES + 1 - output.size()))) > 0) output.write(buffer, 0, count);
                    bytes = output.toByteArray();
                }
                if (bytes.length > MAX_PAGE_BYTES) continue;
                total += bytes.length;
                for (Image row : describePage(page.getName(), new String(bytes, StandardCharsets.UTF_8), selected)) {
                    Image old = descriptions.get(row.entry);
                    if (old == null || old.caption.isEmpty() && !row.caption.isEmpty()) descriptions.put(row.entry, row);
                }
            }
            for (String name : selected) {
                result.add(descriptions.getOrDefault(name, new Image(name, "", "", "", "unidentified")));
            }
        }
        return result;
    }
}
