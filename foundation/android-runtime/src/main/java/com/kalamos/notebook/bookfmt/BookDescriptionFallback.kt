package com.kalamos.notebook.bookfmt

/**
 * Selects a short, truthful excerpt when a publisher did not embed a description. It intentionally
 * does not summarize or infer a plot: the text is copied from the book and labelled as such.
 */
object BookDescriptionFallback {
    private const val MAX_CHARS = 420
    private const val MIN_CHARS = 120

    fun fromCandidates(candidates: Sequence<String>): String? {
        val text = candidates.map(::normalize).firstOrNull(::isUseful) ?: return null
        val clipped = clipAtWordOrSentence(text, MAX_CHARS)
        return "From the book: $clipped"
    }

    private fun normalize(value: String): String =
        value.replace(Regex("""\s+"""), " ").trim()

    private fun isUseful(value: String): Boolean {
        if (value.length < MIN_CHARS || value.split(' ').size < 20) return false
        val lead = value.take(180).lowercase()
        return rejectedLeads.none { lead.startsWith(it) } &&
            rejectedPhrases.none { lead.contains(it) }
    }

    private fun clipAtWordOrSentence(value: String, maxChars: Int): String {
        if (value.length <= maxChars) return value
        val window = value.take(maxChars + 1)
        val sentenceEnd = listOf(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "))
            .maxOrNull()?.takeIf { it >= MIN_CHARS }
        val end = sentenceEnd?.plus(1)
            ?: window.lastIndexOf(' ').takeIf { it >= MIN_CHARS }
            ?: maxChars
        return value.take(end).trimEnd() + "…"
    }

    private val rejectedLeads = listOf(
        "contents", "table of contents", "copyright", "all rights reserved",
        "title page", "index", "acknowledgements", "acknowledgments"
    )
    private val rejectedPhrases = listOf(
        "all rights reserved", "no part of this publication may be reproduced"
    )
}
