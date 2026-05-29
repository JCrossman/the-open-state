"""Provider abstraction for The Open State: Camping.

This module is the boundary the rest of the system depends on. MCP tools call
the :class:`CampingProvider` interface only; they never import camply or talk to
a booking platform directly. Each platform (Parks Canada now, Alberta Parks
later) is wrapped by one concrete provider that maps its native data into the
normalized shapes defined here.

Keeping this layer platform-agnostic is what lets a new service be added without
touching tool code (see docs/01-architecture.md, "Provider abstraction").

Constitution notes that bind every provider:
- Nothing here logs in, books, pays, or submits on a citizen's behalf. The
  ``booking_url`` method only *prepares* a deep link the citizen confirms
  themselves (Article 2).
- No citizen credentials are accepted, stored, or transmitted by this interface
  (Article 1).
- ``accessible`` is a first-class field and a search filter because reaching
  accessible sites is the purpose, not an add-on (Article 3).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date
from typing import ClassVar, Optional


@dataclass(frozen=True, slots=True)
class Campground:
    """One bookable campground inside a recreation area.

    A search needs both a recreation area and a campground within it, so
    providers can surface the campgrounds they know about to help a citizen
    choose one in plain language.
    """

    provider: str
    recreation_area_id: str
    campground_id: str
    name: str


@dataclass(frozen=True, slots=True)
class RecreationArea:
    """A park or bookable region, with the id later calls need.

    ``search_parks`` returns these so a plain-language place name (for example
    "Banff") can be turned into the ``recreation_area_id`` that every other call
    requires. Any campgrounds the provider already knows about are included so
    the citizen can pick one without a separate lookup.
    """

    provider: str
    recreation_area_id: str
    name: str
    description: Optional[str] = None
    campgrounds: tuple[Campground, ...] = ()


@dataclass(frozen=True, slots=True)
class EquipmentType:
    """A kind of equipment a site can take, such as a tent or an RV.

    Equipment ids are assigned per recreation area and are platform-specific (on
    Parks Canada they are negative integers), so they must be discovered for a
    given area rather than hard-coded.
    """

    provider: str
    recreation_area_id: str
    equipment_id: str
    name: str


@dataclass(frozen=True, slots=True)
class AvailableSite:
    """One campsite that is open for the requested dates.

    This is the single shape every provider returns from ``search_sites``, so
    the tools and the citizen's assistant see Parks Canada and (later) Alberta
    Parks results identically. Map each platform's native fields into this; do
    not leak platform-specific shapes above the provider layer.

    ``accessible`` is required, not optional, so accessibility can always be
    stated and filtered on (Constitution Article 3). ``booking_url`` is a deep
    link the citizen opens to confirm the booking themselves; nothing here books
    on their behalf (Article 2).
    """

    provider: str
    recreation_area: str
    recreation_area_id: str
    campground: str
    campground_id: str
    campsite_id: str
    site_name: str
    accessible: bool
    available_dates: tuple[date, ...]
    loop_name: Optional[str] = None
    site_type: Optional[str] = None
    max_occupancy: Optional[int] = None
    price: Optional[float] = None
    booking_url: Optional[str] = None


@dataclass(frozen=True, slots=True)
class SiteDetails:
    """Rich, plain-language detail about a single campsite.

    Returned by ``site_details`` for the ``get_site_details`` tool.
    Accessibility information is surfaced explicitly and in plain words
    (``accessibility_notes``), not buried in a list of platform codes
    (Constitution Article 3).
    """

    provider: str
    recreation_area_id: str
    campsite_id: str
    site_name: str
    accessible: bool
    description: Optional[str] = None
    amenities: tuple[str, ...] = ()
    accessibility_notes: tuple[str, ...] = ()
    photos: tuple[str, ...] = ()
    max_occupancy: Optional[int] = None
    site_type: Optional[str] = None


class CampingProvider(ABC):
    """The interface every booking platform is wrapped behind.

    Concrete providers (for example ``ParksCanadaProvider``) implement these
    methods and return the normalized shapes above. Tool code depends only on
    this class, never on a specific platform or library, so a new service can be
    added without changing the tools (docs/01-architecture.md).

    Identifiers cross this boundary as strings to stay platform-agnostic; a
    provider converts them to whatever its platform needs internally. Every
    method here is read-only and free of consequential side effects: nothing
    logs in, books, pays, or stores citizen data (Constitution Articles 1
    and 2).
    """

    #: Short, stable machine name for this provider, for example "parks_canada".
    #: Concrete providers must set this.
    name: ClassVar[str]

    @abstractmethod
    def search_parks(self, query: str, country: str = "CA") -> list[RecreationArea]:
        """Find parks or regions whose name matches a plain-language query.

        Turns a place name a citizen would say into the recreation-area id (and,
        where known, the campgrounds) that the other methods need.
        """

    @abstractmethod
    def list_equipment_types(self, recreation_area_id: str) -> list[EquipmentType]:
        """List the equipment types that are valid for a recreation area.

        Equipment ids are per-area, so they must be looked up for the specific
        area before they can be used as a ``search_sites`` filter.
        """

    @abstractmethod
    def search_sites(
        self,
        *,
        recreation_area_id: str,
        campground_id: str,
        start_date: date,
        end_date: date,
        party_size: int,
        equipment_type: Optional[str] = None,
        accessible_only: bool = False,
        nights: Optional[int] = None,
        weekends_only: bool = False,
    ) -> list[AvailableSite]:
        """Find campsites that are open for the requested stay.

        Returns normalized :class:`AvailableSite` results. When
        ``accessible_only`` is true, only sites marked accessible are returned.
        This is a read-only availability check; it never holds a site or books.
        """

    @abstractmethod
    def site_details(
        self,
        *,
        recreation_area_id: str,
        campground_id: str,
        campsite_id: str,
    ) -> SiteDetails:
        """Get full, plain-language detail for one campsite.

        Includes capacity, accessibility notes stated in plain words, and photos.
        ``campground_id`` is required because platforms expose site detail per
        campground, not globally (verified for Parks Canada; the per-site detail
        endpoint camply used was removed upstream — see
        docs/parks-canada-api-findings.md).
        """

    @abstractmethod
    def booking_url(
        self,
        *,
        recreation_area_id: str,
        campground_id: str,
        campsite_id: str,
        start_date: date,
        end_date: date,
        party_size: int,
        equipment_type: Optional[str] = None,
    ) -> str:
        """Build a deep link the citizen opens to confirm the booking themselves.

        This only *prepares* a booking. It must never complete a booking, take
        payment, or submit anything on the citizen's behalf. The citizen
        confirms and pays in their own logged-in session (Constitution
        Article 2).
        """
