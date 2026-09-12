from django.contrib import admin

from catalog.models import MenuCategory, MenuItem, Modifier, ModifierGroup, TaxClass

admin.site.register(MenuCategory)
admin.site.register(MenuItem)
admin.site.register(ModifierGroup)
admin.site.register(Modifier)
admin.site.register(TaxClass)
