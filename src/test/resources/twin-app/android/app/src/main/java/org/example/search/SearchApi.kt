package org.example.search

interface SearchApi {
    suspend fun search(query: String, limit: Int): List<String>
}
