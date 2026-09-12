from django.contrib import admin

from orders.models import KitchenTicket, KitchenTicketItem, Order, OrderItem, OrderItemModifier

admin.site.register(Order)
admin.site.register(OrderItem)
admin.site.register(OrderItemModifier)
admin.site.register(KitchenTicket)
admin.site.register(KitchenTicketItem)
