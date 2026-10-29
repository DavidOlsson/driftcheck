package driftcheck.model

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialInfo
import kotlinx.serialization.descriptors.PolymorphicKind
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.SerialKind
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The JSON schema for `claude -p --json-schema`, generated from the same classes that parse the answer, so the two
 * can never disagree. Rules the schema cannot express are checked after parsing (see `problems()`).
 */
fun jsonSchemaOf(serializer: KSerializer<*>): JsonObject = schemaOf(serializer.descriptor)

/**
 * Puts `minItems` on a list in the generated schema, so structured output already refuses a shorter list instead of
 * only the check after parsing.
 */
@OptIn(ExperimentalSerializationApi::class)
@SerialInfo
@Target(AnnotationTarget.PROPERTY)
annotation class MinItems(val count: Int)

@OptIn(ExperimentalSerializationApi::class)
private fun schemaOf(descriptor: SerialDescriptor): JsonObject {
    val schema = when (val kind = descriptor.kind) {
        PrimitiveKind.STRING, PrimitiveKind.CHAR -> type("string")

        PrimitiveKind.INT, PrimitiveKind.LONG, PrimitiveKind.SHORT, PrimitiveKind.BYTE -> type("integer")

        PrimitiveKind.DOUBLE, PrimitiveKind.FLOAT -> type("number")

        PrimitiveKind.BOOLEAN -> type("boolean")

        SerialKind.ENUM -> buildJsonObject {
            put("type", "string")
            put("enum", JsonArray((0 until descriptor.elementsCount).map { JsonPrimitive(descriptor.getElementName(it)) }))
        }

        StructureKind.LIST -> buildJsonObject {
            put("type", "array")
            put("items", schemaOf(descriptor.getElementDescriptor(0)))
        }

        StructureKind.CLASS, StructureKind.OBJECT -> buildJsonObject {
            put("type", "object")
            put(
                "properties",
                JsonObject(
                    (0 until descriptor.elementsCount).associate { descriptor.getElementName(it) to elementSchema(descriptor, it) },
                ),
            )
            val required = (0 until descriptor.elementsCount).filterNot { descriptor.isElementOptional(it) }
            put("required", JsonArray(required.map { JsonPrimitive(descriptor.getElementName(it)) }))
            // Structured output requires closed objects
            put("additionalProperties", false)
        }

        is PolymorphicKind, StructureKind.MAP, SerialKind.CONTEXTUAL ->
            error("${descriptor.serialName} uses $kind, which the model schema does not support")
    }
    return if (descriptor.isNullable) buildJsonObject { put("anyOf", JsonArray(listOf(schema, type("null")))) } else schema
}

@OptIn(ExperimentalSerializationApi::class)
private fun elementSchema(parent: SerialDescriptor, index: Int): JsonObject {
    val schema = schemaOf(parent.getElementDescriptor(index))
    val minItems = parent.getElementAnnotations(index).filterIsInstance<MinItems>().firstOrNull() ?: return schema
    return JsonObject(schema + ("minItems" to JsonPrimitive(minItems.count)))
}

private fun type(name: String) = buildJsonObject { put("type", name) }
