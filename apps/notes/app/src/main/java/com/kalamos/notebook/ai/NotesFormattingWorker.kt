package com.kalamos.notebook.ai

import android.content.Context
import androidx.work.*
import com.kalamos.notebook.exchange.NotesBackgroundProcessing
import java.util.concurrent.TimeUnit

class NotesFormattingWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val requestId = inputData.getString("requestId") ?: return Result.failure()
        return if (NotesBackgroundProcessing(applicationContext).execute(requestId)) Result.success() else Result.failure()
    }
    companion object {
        fun enqueue(context: Context, requestId: String) {
            val work = OneTimeWorkRequestBuilder<NotesFormattingWorker>()
                .setInputData(workDataOf("requestId" to requestId))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .keepResultsForAtLeast(1, TimeUnit.DAYS).build()
            WorkManager.getInstance(context).enqueueUniqueWork("notes-format-$requestId", ExistingWorkPolicy.KEEP, work)
        }
    }
}
