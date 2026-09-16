#### Minutes of Meeting: SPARK P2P-WS021/I2D-WS059: Manufacturing Execution I in SAP Process Orders &amp; Warehouse Production

**Date: 18th June 2025 Time: 13:29 CEST Location: Virtual Meeting Attendees:**

- Alice Micheli
- André Neves
- Artur Lino
- Bruna Marra
- Frederic MANIERES
- Inacio Cassimiro
- Jeong-yul Shin
- Joel Sevilla
- Jolien Van Buyten
- Lorenzo Zabala
- Ludovic Roux
- Mateus Lima
- Ninad Snehal Manjardekar
- Pascal Barbier puente
- Ramakanth Kothapally
- Stefano Righi
- Vinicius Zappala

#### Summary

The meeting focused on the execution of manufacturing processes within SAP, specifically addressing material availability, consumable materials management, back flushing, goods receipt, handling unit creation, rework processes, and error management. Each topic was evaluated for its applicability within the standard SAP framework or identified as requiring additional development to meet specific business needs.

Material availability checks and consumable materials management were discussed as crucial elements for ensuring smooth production execution. The group explored the standard SAP functionalities and identified areas where specific configurations might be necessary. Back flushing and goods receipt processes were examined, with emphasis on automation and real-time tracking, highlighting the need for potential adjustments to align with current practices.

Handling unit creation and labeling, along with rework processes, were reviewed to ensure compliance with industry standards and operational efficiency. Error management using the COGI transaction was addressed, focusing on the correction of errors during automatic goods movement. The meeting concluded with follow-up tasks to confirm practices and configurations, aiming to harmonize processes across different systems.

**Agenda:**

1. Material Availability Check
2. Consumable Materials Management
3. Back Flushing Process
4. Goods Receipt Process
5. Handling Unit Creation and Labeling
6. Rework Process
7. Error Management with COGI

**Discussion Points:**

**M-090-010 Check for Material Availability- DONE**

**Material Availability Check:**

- Importance of ensuring sufficient material availability before production begins.
- Material availability check can be activated at order creation, order release, or manually.
- Configuration of scope of check includes MRP elements, safety stock, batch checks, storage locations, etc.
- **Applicable:** Standard SAP functionality.

**M-090-090 Schedule Consumable Material Requirements -DONE**

**Consumable Materials Management:**

- Consumable materials are not managed on a quantity basis in inventory.
- Cost is directly charged to a cost center, internal order, project, or asset at the time of goods receipt.
- Options for managing consumable materials include codified inventory tracking and automatic reorder point MRP.
- **Applicable:** Standard SAP functionality.

**M-100-020 Backflush Raw Materials - DONE**

**Back Flushing Process:**

- Automatic goods issue of components during order confirmation.
- Back flushing can be activated at different levels: material master, work center, recipe, or process order.
- **Applicable:** Standard SAP functionality.

**M-100-240 REJECT COMPONENT MATERIAL - Done**

**M-100-020 - Backflush Raw Materials - DONE**

**M-100-030  Issue Materials for next phase - DONE**

**M-100-010 Confirm process Order operation - Done**

**M-100-040 Perform Final Confirmation**

**Goods Receipt Process:**

- Inbound delivery creation and distribution to EWM upon process order confirmation.
- Handling unit creation and labeling based on packing specifications.
- Physical receipt and putaway process managed through RF devices or Fiori apps.
- Quality inspection and putaway based on user decision.
- **Gap:** Requires development for specific configurations.

**M-140-120 Blend**

Still to be discussed

**M-140-030 Rework**

Still to be discussed in other meeting

**M-100-280 Batch determination for raw materials**

- Applicable
- GAP
- Comment: confirm if batch determination will happen in EWM?

**M-100-100 Build Pallet**

- Applicable
- FIT
- Comment: /

**M-100-090 Archive Process Record**

- Applicable
- Fit
- Standard sap

**M-100-070 Order Closure**

- Applicable
- Fit
- Standard sap

**M-100-120 Consume Material/Re-ordder material**

- Applicable
- Fit
- Standard sap

**M-090-040 Expedite missing materials**

- Applicable
- Fit
- Standard sap

**M-140-100 Manage blocked stock**

- Applicable
- Fit
- Standard sap

**M-100-040 Print Production Labels**

**Handling Unit Creation and Labeling:**

- Labels are printed automatically based on packing specifications.
- Handling units are created and managed within the EWM system.
- Discussion on the timing and process of label printing and handling unit creation.
- **Gap:** Requires development for specific configurations.

**M-100-060 Correct the errors in goods movement**

**Error Management with COGI:**

- COGI transaction used for managing and correcting errors during automatic goods movement.
- Common errors include insufficient stock, incorrect material master or batch information, storage location issues, etc.
- **Applicable:** Standard SAP functionality.

**Follow-Up Tasks:**

- Clarification needed on how consumable materials are managed, particularly in terms of inventory tracking and reordering.

- Specific interface for goods issue related to a weight/scale system needs confirmation.

**Next Meeting:**

- Schedule a follow-up meeting to discuss rework process and any remaining topics.