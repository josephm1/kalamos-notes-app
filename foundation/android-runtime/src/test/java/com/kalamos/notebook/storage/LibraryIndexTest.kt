package com.kalamos.notebook.storage

import org.junit.Assert.assertEquals
import org.junit.Test

class LibraryIndexTest {
    @Test fun preservesLastOpenedAndNestedFoldersAcrossJsonRoundTrip() {
        val library = LibraryIndex(
            version = 2,
            notebooks = listOf(NotebookInfo(
                notebookId = "book-one",
                title = "One",
                folderId = "folder-child",
                createdAt = "2026-01-01T00:00:00Z",
                updatedAt = "2026-01-02T00:00:00Z",
                defaultTemplate = Template.DEFAULT,
                lastOpenedAt = "2026-01-03T00:00:00Z"
            )),
            folders = listOf(
                FolderInfo("folder-root", "Root", "", "2026-01-01T00:00:00Z"),
                FolderInfo("folder-child", "Child", "folder-root", "2026-01-01T00:00:00Z")
            )
        )

        val restored = LibraryIndex.fromJson(library.toJson())
        assertEquals("2026-01-03T00:00:00Z", restored.notebooks.single().lastOpenedAt)
        assertEquals("folder-root", restored.folders.last().parentFolderId)
    }
}
