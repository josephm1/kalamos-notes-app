package com.kalamos.foundation.documents;

import org.junit.Test;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import static org.junit.Assert.*;

public class EpubImageCatalogTest {
    @Test public void opaqueClassesRetainNumberedEmphasizedCaption() {
        var rows = EpubImageCatalog.describePage("OPS/text/chapter.xhtml",
                "<p class='x8'><a></a><img src='../images/plate.jpg' alt='image'/></p><div>&nbsp;</div>"
                + "<p class='x2'><a id='plate'></a><strong>1. <em>A courtyard</em> by Someone (1894).</strong></p>");
        assertEquals("OPS/images/plate.jpg", rows.get(0).entry);
        assertEquals("1. A courtyard by Someone (1894).", rows.get(0).caption);
        assertEquals("adjacent-caption", rows.get(0).captionMethod);
        assertEquals("OPS/text/chapter.xhtml", rows.get(0).sourcePage);
        assertFalse(rows.get(0).locator.isEmpty());
    }
    @Test public void ordinaryNextParagraphDoesNotBecomeEvidenceAboutAnImage() {
        var row = EpubImageCatalog.describePage("chapter.html",
                "<p><img src='picture.jpg' alt='image'/></p><p>The next argument begins here.</p>").get(0);
        assertEquals("", row.caption);
        assertEquals("unidentified", row.captionMethod);
    }
    @Test public void semanticCaptionsAndEntitiesArePreservedWithoutFetching() {
        var row = EpubImageCatalog.describePage("OPS/chapter.html",
                "<figure><img src='images/a.jpg'/><figcaption>A &amp; B, not C.</figcaption></figure>").get(0);
        assertEquals("A & B, not C.", row.caption);
        assertEquals("figcaption", row.captionMethod);
        assertNull(EpubImageCatalog.resolve("OPS/chapter.html", "https://example.org/a.jpg"));
        assertNull(EpubImageCatalog.resolve("OPS/chapter.html", "../../escape.jpg"));
        assertEquals("OPS/images/a b.jpg", EpubImageCatalog.resolve("OPS/chapter.html", "images/a%20b.jpg#view"));
    }
    @Test public void captionForMultipleImagesIsNotSilentlyAssignedToEach() {
        var rows = EpubImageCatalog.describePage("chapter.html",
                "<figure><img src='a.jpg'/><img src='b.jpg'/><figcaption>A group comparison.</figcaption></figure>");
        assertEquals("", rows.get(0).caption);
        assertEquals("", rows.get(1).caption);
    }
    @Test public void identicalBasenamesBindToExactArchivePaths() throws Exception {
        File file = Files.createTempFile("catalog-test", ".epub").toFile();
        try {
            try (var zip = new ZipOutputStream(Files.newOutputStream(file.toPath()))) {
                add(zip, "OPS/one/chapter.html", "<figure><img src='plate.jpg'/><figcaption>The first plate.</figcaption></figure>".getBytes(StandardCharsets.UTF_8));
                add(zip, "OPS/two/chapter.html", "<figure><img src='plate.jpg'/><figcaption>The second plate.</figcaption></figure>".getBytes(StandardCharsets.UTF_8));
                add(zip, "OPS/one/plate.jpg", new byte[5000]);
                add(zip, "OPS/two/plate.jpg", new byte[5000]);
            }
            var rows = EpubImageCatalog.read(file);
            assertEquals(2, rows.size());
            assertEquals("The first plate.", rows.get(0).caption);
            assertEquals("The second plate.", rows.get(1).caption);
        } finally { assertTrue(file.delete()); }
    }
    @Test public void largeBookRetainsBoundedArchiveOrderAndExactCaptions() throws Exception {
        File file = Files.createTempFile("catalog-many-images", ".epub").toFile();
        try {
            try (var zip = new ZipOutputStream(Files.newOutputStream(file.toPath()))) {
                StringBuilder html = new StringBuilder();
                for (int i = 0; i < 80; i++) html.append("<figure><img src='image")
                        .append(i).append(".jpg'/><figcaption>Figure ").append(i).append(" caption.</figcaption></figure>");
                add(zip, "OPS/chapter.html", html.toString().getBytes(StandardCharsets.UTF_8));
                add(zip, "OPS/cover.jpg", new byte[5000]);
                for (int i = 0; i < 80; i++) add(zip, "OPS/image" + i + ".jpg", new byte[5000]);
            }
            var rows = EpubImageCatalog.read(file);
            assertEquals(EpubImageCatalog.MAX_IMAGES, rows.size());
            for (int i = 0; i < rows.size(); i++) {
                assertEquals("OPS/image" + i + ".jpg", rows.get(i).entry);
                assertEquals("Figure " + i + " caption.", rows.get(i).caption);
                assertEquals("figcaption", rows.get(i).captionMethod);
                assertFalse(rows.get(i).locator.isEmpty());
            }
        } finally { assertTrue(file.delete()); }
    }
    private static void add(ZipOutputStream zip, String path, byte[] bytes) throws Exception {
        zip.putNextEntry(new ZipEntry(path)); zip.write(bytes); zip.closeEntry();
    }
}
