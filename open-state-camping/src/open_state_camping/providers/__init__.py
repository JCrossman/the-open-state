"""Provider layer for The Open State: Camping.

Import the platform-agnostic interface and normalized data shapes from here.
Concrete providers (such as the Parks Canada wrapper) are added in later steps
and registered without changing tool code.
"""

from open_state_camping.providers.base import (
    AvailableSite,
    Campground,
    CampingProvider,
    EquipmentType,
    RecreationArea,
    SiteDetails,
)
from open_state_camping.providers.parks_canada import ParksCanadaProvider

__all__ = [
    "AvailableSite",
    "Campground",
    "CampingProvider",
    "EquipmentType",
    "ParksCanadaProvider",
    "RecreationArea",
    "SiteDetails",
]
