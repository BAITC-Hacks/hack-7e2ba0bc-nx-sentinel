"""Bounded uploads. No filenames, paths, pickle, or executable content are accepted."""

import csv
import io
import json

from pydantic import ValidationError

from ai.models.workspace import Dataset, DomainError

MAX_BYTES = 20 * 1024 * 1024
ALIASES = {"customer_id": "id", "subscriber_id": "id", "arpu_3m_avg": "arpu"}


def _reject_constant(value):
    raise ValueError("Non-finite JSON number")


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def parse_dataset(content: bytes, media_type: str) -> Dataset:
    if len(content) > MAX_BYTES:
        raise DomainError("FILE_TOO_LARGE", "Dataset exceeds the 20 MB limit.", 413)
    if not content.strip():
        raise DomainError("EMPTY_DATASET", "Upload a non-empty CSV or JSON dataset.")
    try:
        text = content.decode("utf-8-sig")
        if media_type == "text/csv":
            reader = csv.DictReader(io.StringIO(text), strict=True)
            headers = reader.fieldnames
            if not headers or len(headers) != len(set(headers)) or len(headers) > 64:
                raise ValueError("Invalid headers")
            rows = []
            for row in reader:
                if None in row or None in row.values() or len(rows) >= 100000:
                    raise ValueError("Invalid row width or row count")
                rows.append({key: value for key, value in row.items() if value.strip()})
            raw = {"customer_profile": rows}
        elif media_type == "application/json":
            raw = json.loads(
                text, parse_constant=_reject_constant, object_pairs_hook=_unique_object
            )
        else:
            raise DomainError(
                "UNSUPPORTED_FORMAT", "Use text/csv or application/json.", 415
            )
        if not isinstance(raw, dict) or not isinstance(
            raw.get("customer_profile"), list
        ):
            raise TypeError("Expected dataset object")
        normalized = []
        for row in raw["customer_profile"]:
            if not isinstance(row, dict):
                raise TypeError("Expected subscriber object")
            out = {}
            for key, value in row.items():
                key = ALIASES.get(key, key)
                if key in out:
                    raise ValueError("Conflicting aliases")
                out[key] = value
            normalized.append(out)
        raw["customer_profile"] = normalized
        dataset = Dataset.model_validate(raw)
        for group in (dataset.customer_profile, dataset.tariffs, dataset.channels):
            if len({item.id for item in group}) != len(group):
                raise DomainError(
                    "DUPLICATE_ID", "Dataset IDs must be unique within each collection."
                )
        segments = [row.arpu_segment is not None for row in dataset.customer_profile]
        if any(segments) and not all(segments):
            raise DomainError(
                "INCOMPLETE_SEGMENTS",
                "Provide arpu_segment for every subscriber, or omit it for all.",
            )
        if dataset.tariffs:
            known = {row.id for row in dataset.tariffs}
            if any(row.current_tariff not in known for row in dataset.customer_profile):
                raise DomainError(
                    "UNKNOWN_TARIFF",
                    "A current tariff is missing from the tariff catalog.",
                )
            if any(
                row.current_tariff not in known or row.target_tariff not in known
                for row in dataset.change_tariff
            ):
                raise DomainError(
                    "UNKNOWN_TARIFF",
                    "A historical transition references an unknown tariff.",
                )
        return dataset
    except ValidationError as error:
        # Never echo Pydantic input values (they may contain personal data or secrets).
        fields = sorted(
            {
                "<unknown field>"
                if item["type"] == "extra_forbidden"
                else ".".join(str(part) for part in item["loc"])
                for item in error.errors(include_input=False)
            }
        )[:5]
        raise DomainError(
            "INVALID_DATASET", "Invalid or missing fields: " + ", ".join(fields)
        ) from None
    except (ValueError, TypeError, UnicodeError, csv.Error, RecursionError):
        raise DomainError(
            "INVALID_DATASET",
            "Malformed dataset. Required subscriber fields: id, current_tariff, arpu (finite and non-negative).",
        ) from None
