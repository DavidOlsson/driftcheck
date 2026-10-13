package driftcheck

/**
 * An expected problem with the user's setup, input or a Claude run. The message says what to do, and the CLI
 * prints it without a stack trace; anything else is a bug and keeps its stack trace.
 */
open class UserException(message: String, cause: Throwable? = null) : Exception(message, cause)
