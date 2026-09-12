from django.contrib import admin

from hotel.models import Folio, FolioLine, GuestStay, Reservation, Room, RoomType

admin.site.register(RoomType)
admin.site.register(Room)
admin.site.register(Reservation)
admin.site.register(GuestStay)
admin.site.register(Folio)
admin.site.register(FolioLine)
