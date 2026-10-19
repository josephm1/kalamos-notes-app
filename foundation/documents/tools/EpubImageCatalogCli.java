import com.kalamos.foundation.documents.EpubImageCatalog;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/** Host evaluation adapter for the exact Android-owned parser; no second extraction algorithm. */
public class EpubImageCatalogCli {
    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("Supply one local EPUB path");
        for (var row : EpubImageCatalog.read(new File(args[0]))) {
            System.out.println(encode(row.entry) + "\t" + encode(row.caption) + "\t" + encode(row.sourcePage)
                    + "\t" + encode(row.locator) + "\t" + encode(row.captionMethod));
        }
    }
    private static String encode(String value) {
        return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }
}
