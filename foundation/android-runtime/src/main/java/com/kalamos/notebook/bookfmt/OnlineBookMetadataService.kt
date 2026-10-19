package com.kalamos.notebook.bookfmt

/** Format-independent query built from metadata already extracted from a PDF, EPUB or blocks book. */
data class BookMetadataQuery(
    val title: String?,
    val authors: List<String>,
    val identifiers: List<String>,
    /** User is waiting on this lookup; providers may use it for scheduling/diagnostics. */
    val interactive: Boolean = false
)

enum class OnlineLookupStatus { FOUND, NOT_FOUND, UNAVAILABLE }

data class OnlineBookMetadataResult(
    val status: OnlineLookupStatus,
    val provider: String,
    val metadata: EmbeddedBookMetadata? = null,
    val recordId: String? = null
)

/**
 * App-owned online catalogue seam. The shared importer knows how to merge a normalized result but
 * does not depend on a provider, API key, endpoint or network library.
 */
fun interface OnlineBookMetadataService {
    fun lookup(query: BookMetadataQuery): OnlineBookMetadataResult
}
