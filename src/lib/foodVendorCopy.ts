/**
 * Admin copy for `/admin/products` reframed as online food-vendor / park restaurant sales.
 * Product APIs and `products:*` permissions stay the same — labels only.
 */
export const FOOD_VENDOR_COPY = {
  navGroup: "Food sales",
  navItems: "Menu items",
  pageTitle: "Menu items",
  pageSubtitle:
    "Sell food and drinks from your park restaurant or food vendors — guests order online.",
  addButton: "Add menu item",
  addModalTitle: "Food item details",
  addPhotosTitle: "Add photos",
  editModalTitle: "Edit menu item",
  saveButton: "Save menu item",
  updateButton: "Update menu item",
  deleteTitle: "Delete menu item",
  deleteButton: "Delete menu item",
  emptyList: "No menu items yet",
  loading: "Opening menu items…",
  meterLabel: "menu items",
  meterPrefix: "Menu",
  permissionFeature: "Menu items",
  itemName: "Item name",
  itemDescription: "Description",
  itemCategory: "Menu category",
  successCreate: "Menu item added successfully!",
  successUpdate: "Menu item updated successfully!",
  noPermissionAdd: "You do not have permission to add menu items",
} as const;
