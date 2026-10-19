package com.kalamos.notebook.bookfmt

/**
 * App-owned PDF text extraction seam (AD-1). The only third-party dependency in the whole PDF
 * stack, pdfbox-android, lives in the Books app — the shared runtime only defines this interface
 * so notes/todo/scribe keep compiling with zero new deps. kalamos-books' `BooksApp` registers a
 * `PdfBoxTextService` into [BookServices.pdfText] at startup (WP8). Unregistered ([pdfText] null)
 * means PDF text features (outline, page text, search, article mode) degrade gracefully — callers
 * must null-check rather than assume a service is present.
 */
interface PdfTextService {

    /**
     * Normalized embedded PDF metadata as JSON. Implementations should return an object containing
     * any available [EmbeddedBookMetadata] fields and "{}" when the document has none.
     */
    fun embeddedMetadata(notebookId: String): String = "{}"

    /** Short source-text excerpt used only when embedded description/subject metadata is absent. */
    fun fallbackDescription(notebookId: String): String? = null

    /** Plain text of one page (0-based [pageIndex]), or null if extraction fails / no text layer. */
    fun pageText(notebookId: String, pageIndex: Int): String?

    /** Positioned selectable text for one page. Coordinates use the rendered-page convention
     *  (origin at upper-left) and the JSON shape `{w,h,runs:[{t,x,y,w,h}]}`. */
    fun pageTextLayout(notebookId: String, pageIndex: Int): String = "{}"

    /** Flatten reader sidecars (highlights, handwriting, inserted pages) into a new PDF. */
    fun exportAnnotatedPdf(notebookId: String): ByteArray? = null

    /** Outline / bookmarks tree as a JSON array string (`[{"label":..,"pageIndex":..,"children":[...]}]`),
     *  or "[]" if the PDF has none. */
    fun outline(notebookId: String): String

    /** Whether the PDF has an extractable text layer at all (false ⇒ scanned-image only; article
     *  mode/search/outline are disabled with a visible notice). */
    fun hasTextLayer(notebookId: String): Boolean

    /** Release any format-specific session retained for [notebookId]. */
    fun close(notebookId: String) {}
}

/** Process-wide registration point for the app-owned [PdfTextService]. `@Volatile` because it's
 *  written once from the app's Application.onCreate() and read from bridge/background threads. */
object BookServices {
    @Volatile
    var pdfText: PdfTextService? = null

    @Volatile
    var onlineMetadata: OnlineBookMetadataService? = null
}
