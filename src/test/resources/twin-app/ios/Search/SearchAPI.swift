protocol SearchAPI {
    func search(_ query: String, limit: Int) async throws -> [String]
}
