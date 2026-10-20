package com.kalamos.notebook.ai

import android.app.Application
import com.kalamos.notebook.R
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.xmlpull.v1.XmlPullParser

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class NotesBackupPolicyTest {
    @Test fun secretPreferencesAndInterruptedWriteBackupsAreExcludedFromEveryBackupRoute() {
        val context = RuntimeEnvironment.getApplication()
        for ((resource, copies) in listOf(R.xml.notes_backup_rules to 1, R.xml.notes_data_extraction_rules to 2)) {
            val counts = mutableMapOf<String, Int>()
            context.resources.getXml(resource).use { xml ->
                while (xml.next() != XmlPullParser.END_DOCUMENT) {
                    if (xml.eventType == XmlPullParser.START_TAG && xml.name == "exclude" &&
                        xml.getAttributeValue(null, "domain") == "sharedpref") {
                        val path = xml.getAttributeValue(null, "path")
                        counts[path] = counts.getOrDefault(path, 0) + 1
                    }
                }
            }
            assertEquals(copies, counts["scribe_secrets.xml"])
            assertEquals(copies, counts["scribe_secrets.xml.bak"])
        }
    }
}
