# Imagine Design Workshop  Plan to Produce | P2P

# Manufacturing Plant

08/10/2025

# Workshop Goals  after agenda

We would expect the following outputs and deliverables coming from the workshops:

|   # | Workshop Topics                       | Output                                                                                     | Location links / format                                      |
|-----|---------------------------------------|--------------------------------------------------------------------------------------------|--------------------------------------------------------------|
|   1 | Review process design                 | Update Celonis process model Fiori apps (Executables) Swim lanes w/ roles in process model | L3 Sub-Process in Celonis L4 Process Steps in Celonis        |
|   2 | Key design decisions                  | Create KDD                                                                                 | KDD log in Jira + KDD Template in Google Drive               |
|   3 | Fit/Gap analysis                      | List of Fits/Gaps identified                                                               | Fit & Gap Identification in Jira Build Backlog  Gap template |
|   4 | Functional Integration considerations | Create KDD for Integrations                                                                | KDD log in Jira KDD Template in Google Drive                 |

# Workshop Agenda

Manufacturing Plant

1. Definition and objectives of Manufacturing plant
2. Where is used
3. Scenarios
4. Feedback from the audience

# Manufacturing  plant definition 

- Manufacturing plant is the identification from where the material is produced, by the plant code in SAP
- It is also called Industrial Origin in PF1
- We are harmonizing the name as Manufacturing plant for all GBUs in S4 Hana
- For monocenter materials, it is a “fixed” plant code, based on the standard field “industrial origin” in material master views
- For multicenter materials, it is a specific batch characteristic that must be used in all batches classes linked to the material codes that are produced and batch managed

# Workshop Agenda

Manufacturing Execution Reporting

1. Definition and objectives of Manufacturing plant
2. Where is used
3. Scenarios
4. Feedback from the audience

# Manufacturing  plant – Where is used 

- Quality processes: used as a COA content/field
- 
- Accounting / financial processes: is used to manage the transfer price, reporting and other specific processes 

# Workshop Agenda

Manufacturing Execution Reporting

1. Definition and objectives of Manufacturing plant
2. Where is used
3. Scenarios
4. Feedback from the audience

# Manufacturing  plant – Scenarios 

Goods receipt in PP-REM 

- The identification is done via movement type 131 and transaction type WS. Execution is done via MFBF, MF42N. If it’s not packaging the industrial origin is set directly. 
- 

Byproduct in PP-REM 

- The identification is done via movement type 531. Execution is done via MFBF, MF42N. The industrial origin is set directly. 

Goods receipt in PP-PI 

- The identification is done via movement type 101 and transaction type WF or WR. Execution is done via COR6, CORK, MB31, process message (CO54). If it’s not packaging the industrial origin is set directly. 
- 

Byproduct in PP-PI 

- The identification is done via movement type 531. Execution is done via COR6, CORK, MB1A, process message (CO54). The industrial origin is set directly. 

# Manufacturing  plant – Scenarios 

Packaging

- For the previous cases (except byproducts) a packaging process is possible. This one is defined via the structure of the BOM. If only one finished/semifinished component exists which has the same material group and product hierarchy like the produced material, it’s a packaging process. In this case the industrial origin should be derived from this component batch to the header batch. 

Tolling

MM Subcontracting (80% of the cases)

- The identification is done via movement type 101 and transaction type WE. In addition, the item category for subcontracting in the purchase order is checked. Execution is done via MIGO, MB01. If it’s not packaging, the industrial origin is set directly.

Plant Tolling (20% of the cases)

- The identification is done based in the goods receipt movement (PPREM or PPPI). The industrial origin is set directly. 
- 

Replacement / Transcoding

- With a specific table, a replacement of the found industrial origin can be controlled. The functionality is the same for all scenarios.
- 

# Workshop Agenda

Manufacturing Execution Reporting

1. Definition and objectives of Manufacturing plant
2. Where is used
3. Scenarios
4. Feedback from the audience

# Action Items and Parking Lot

Action items

Parking lot Items

Coatis – Shipping plant -&gt; it is used in COA and, when the manufacturing plant is blank, the respective label is substituted by the Shipping plant coming from the delivery in the CoA layout. Due to the fact that the CoA layout is being harmonized within all GBUs, this specific necessity is now being mapped and will be treated by the PtP team.

Please refer to the following document to find the parking lot items:

# Summary of Previous Discussion

| Type                 | Previous discussion points   |
|----------------------|------------------------------|
| Key Design Decisions |                              |
| Key Design Decisions |                              |
| Key Design Decisions |                              |
| Key Design Decisions |                              |
| Initial Gaps         | /                            |
| Initial Gaps         |                              |
| Initial Gaps         |                              |
| Initial Gaps         |                              |
| Other                | /                            |
| Other                |                              |
| Other                |                              |
| Other                |                              |

<!-- no readable text in image6.png (OCR confidence 47.4) -->

<!-- no readable text in image8.png (OCR confidence 30.3) -->

<!-- no readable text in image7.png (OCR confidence 60.1) -->

# Present related Business Requirements

| Are there any Business Requirements we should keep in mind when discussing and designing processes within this topic?   | Are there any Business Requirements we should keep in mind when discussing and designing processes within this topic?   |
|-------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| Type of Business Requirements                                                                                           | Explanation                                                                                                             |
|                                                                                                                         |                                                                                                                         |
|                                                                                                                         |                                                                                                                         |
|                                                                                                                         |                                                                                                                         |
|                                                                                                                         |                                                                                                                         |
|                                                                                                                         |                                                                                                                         |
|                                                                                                                         |                                                                                                                         |

# Thank you

<!-- no readable text in image2.jpg (OCR confidence 45.3) -->