from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, field_validator

ADAPTER_CONTRACT = "odoo-native-v2"
PositiveInt = Annotated[StrictInt, Field(gt=0)]
_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _is_side_effect_method(value: str) -> bool:
    """Mirror apps/auth-server/src/byok/validation.ts: exact `model.name.method`."""
    model, dot, method = value.rpartition(".")
    if not dot or not model:
        return False
    segments = model.split(".")
    return (
        len(segments) >= 2
        and all(_IDENTIFIER.fullmatch(segment) for segment in segments)
        and _IDENTIFIER.fullmatch(method) is not None
    )


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class OdooPolicy(StrictModel):
    policy_version: Literal[2] = Field(alias="policyVersion")
    enable_writes: StrictBool = Field(alias="enableWrites")
    allowed_side_effect_methods: list[StrictStr] = Field(alias="allowedSideEffectMethods")

    @field_validator("allowed_side_effect_methods")
    @classmethod
    def validate_side_effect_methods(cls, value: list[str]) -> list[str]:
        if len(value) > 200 or len(value) != len(set(value)):
            raise ValueError("allowedSideEffectMethods must contain at most 200 unique entries")
        for method in value:
            if (
                method != method.strip()
                or len(method) > 256
                or not _is_side_effect_method(method)
            ):
                raise ValueError("allowedSideEffectMethods contains an invalid model.method entry")
        return value

    def canonical_methods(self) -> tuple[str, ...]:
        return tuple(sorted(self.allowed_side_effect_methods))


class ResolveResponse(StrictModel):
    connection_id: StrictStr = Field(alias="connectionId")
    user_id: StrictStr = Field(alias="userId")
    version: StrictInt
    base_url: StrictStr = Field(alias="baseUrl")
    database: StrictStr
    login: StrictStr
    api_key: StrictStr = Field(alias="apiKey")
    policy: OdooPolicy
    odoo_uid: PositiveInt | None = Field(alias="odooUid")
    adapter_contract: Literal["odoo-native-v2"] = Field(alias="adapterContract")


class IdentityClaims(StrictModel):
    sub: Annotated[StrictStr, Field(min_length=1)]
    iss: StrictStr
    aud: StrictStr
    connection_id: Annotated[StrictStr, Field(min_length=1)]
    version: PositiveInt
    purpose: Literal["mcp", "test"]
    server: Literal["odoo", "odoo_test"]
    iat: StrictInt
    exp: StrictInt
    jti: Annotated[StrictStr, Field(min_length=1)]
    actor_id: StrictStr | None = None
