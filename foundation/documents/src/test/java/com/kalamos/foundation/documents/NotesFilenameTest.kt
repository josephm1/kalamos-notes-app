package com.kalamos.foundation.documents
import org.junit.Assert.*
import org.junit.Test
class NotesFilenameTest {
 @Test fun readableNamesSurviveAndUnsafeNamesStayWithinOneFile(){
  assertEquals("To do.notes.zip",NotesFilename.zip("To do"))
  assertEquals("Shopping & ideas.notes.zip",NotesFilename.zip("Shopping & ideas"))
  assertEquals("..-outside.notes.zip",NotesFilename.zip("../outside"))
  assertEquals("Notebook.notes.zip",NotesFilename.zip(".."))
  assertFalse(NotesFilename.zip("a/b\\c\u0000").contains('/'))
 }
 @Test fun caseAndUnicodeEquivalentNamesDoNotCollide(){
  assertEquals("To do (3)",NotesFilename.unique("To do",listOf("TO DO","To do (2)")))
  assertEquals("Café (2)",NotesFilename.unique("Cafe\u0301",listOf("Café")))
  assertEquals(NotesFilename.key("A/B"),NotesFilename.key("A:B"))
 }
}
