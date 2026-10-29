package org.example.search

import kotlinx.coroutines.delay

class SearchViewModel(private val api: SearchApi) {
    companion object {
        const val DEBOUNCE_MS = 300L
        const val RESULT_LIMIT = 20
    }

    suspend fun onQueryChanged(query: String): List<String> {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return emptyList()
        delay(DEBOUNCE_MS)
        return api.search(trimmed, limit = RESULT_LIMIT)
    }
}
