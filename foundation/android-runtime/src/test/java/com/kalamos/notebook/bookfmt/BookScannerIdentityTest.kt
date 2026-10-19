package com.kalamos.notebook.bookfmt

import java.io.File
import kotlin.io.path.createTempDirectory
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BookScannerIdentityTest {

    @Test
    fun identicalBytesAreTheSameBookContent() {
        withTempBooks("same-content", "same-content") { first, second ->
            assertTrue(BookScanner.sameBookContent(first, second))
        }
    }

    @Test
    fun equalLengthDifferentBytesAreNotDuplicates() {
        withTempBooks("book-content-a", "book-content-b") { first, second ->
            assertTrue(first.length() == second.length())
            assertFalse(BookScanner.sameBookContent(first, second))
        }
    }

    private fun withTempBooks(
        firstContent: String,
        secondContent: String,
        block: (File, File) -> Unit
    ) {
        val directory = createTempDirectory("book-identity-").toFile()
        try {
            val first = File(directory, "book.epub").apply { writeText(firstContent) }
            val second = File(directory, "selected.epub").apply { writeText(secondContent) }
            block(first, second)
        } finally {
            directory.deleteRecursively()
        }
    }
}
