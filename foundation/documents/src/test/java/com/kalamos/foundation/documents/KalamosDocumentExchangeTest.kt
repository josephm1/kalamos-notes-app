package com.kalamos.foundation.documents

import org.junit.Assert.assertEquals
import org.junit.Test

class KalamosDocumentExchangeTest {
    @Test fun acceptsVersionedExplicitPackage() {
        val out = KalamosDocumentExchange.validate("""{
          "schema":"kalamos.note-package/v1","packageId":"pkg-12345678","title":"Plan",
          "source":{"notebookId":"nb-1","folderId":"folder-1"},
          "parts":[{"kind":"markdown","content":"# Plan"}]
        }""")
        assertEquals("Plan", out.getString("title"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsExecutablePart() {
        KalamosDocumentExchange.validate("""{"schema":"kalamos.note-package/v1","packageId":"pkg-12345678","title":"x","parts":[{"kind":"javascript","content":"alert(1)"}]}""")
    }
}
