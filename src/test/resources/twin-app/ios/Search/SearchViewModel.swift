import Foundation

final class SearchViewModel {
    static let debounceInterval: TimeInterval = 0.5
    static let resultLimit = 50

    private let api: SearchAPI

    init(api: SearchAPI) {
        self.api = api
    }

    func queryChanged(_ query: String) async throws -> [String] {
        if query.isEmpty { return [] }
        try await Task.sleep(nanoseconds: UInt64(Self.debounceInterval * 1_000_000_000))
        return try await api.search(query, limit: Self.resultLimit)
    }
}
