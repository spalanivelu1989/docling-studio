# Imagine Design Workshop  Plan to Produce | Energy Production cycle demo  

29/08/2025

# Agenda

|   Sr. No | Topic                   | Presented by           |
|----------|-------------------------|------------------------|
|        1 | Energy production cycle | Juan Pablo Bernal Nino |

# Energy Production cycle  

BOM structure

1. 

A Bill of Materials (BOM) is a comprehensive list of raw materials, components, and assemblies required to build or manufacture a product. In the context of energy production, the BOM is divided into sections for energy and normal products, each with specific headers and components.

<!-- image5.png read by Qwen3-VL (local vision model) -->

| ENERGY |  |  | Normal Product |  |
|---|---|---|---|---|
| BOM 1 Header | Steam | Coproduct | BOM 1 Header | Soda Ash |
| Component 1 | Electricity | Coproduct | Lime | Normal |
| Component 2 | Pet Coke | Normal | Other raw material | Normal |
| Component 3 | Steam | Normal | Steam | Byproduct |
| Component 4 | Gas | Pipeline |  |  |
|  |  |  |  |  |
| BOILER 1 - WC 1 |  |  |  |  |
|  |  |  |  |  |
| BOM 2 Header | Steam | Coproduct |  |  |
| Component 1 | Electricity | Coproduct |  |  |
| Component 2 | Coal | Normal |  |  |
| Component 3 | Biomass | Normal |  |  |
| Component 4 | Steam | Normal |  |  |

# Energy Production Cycle

Normal Soda Ash Production BOM

BOM 1 Header - Soda Ash: A normal product.

Components:

- Lime: Normal input.
- Other Raw Material (SALT): Normal input.
- Steam: Byproduct, indicating it is produced incidentally during the manufacturing process
- 

Co-product: Items like steam and electricity are produced simultaneously with other products, highlighting their role in energy generation or manufacturing processes.

Normal Inputs: Materials such as Pet Coke, Coal, Biomass, and Lime are standard inputs necessary for the production process.

Byproducts: Steam is identified as a byproduct in the normal product BOM, which can be utilized or sold separately.

# Energy Production Cycle

Energy BOM structure

Energy can be produced with multiple combination of components. Here we have created 2 BOM for production

1. BOM 1 Header - Steam: Coproduced item, indicating it is produced alongside other products.

Components:

- Electricity: Also a Coproduced item.
- Pet Coke: Normal, suggesting it's a standard input.
- Steam: Normal, indicating typical usage.
- Gas: Pipeline, showing a different method of supply.
- 

2. BOM 2 Header - Steam: Again, a Coproduced item.

Components:

- Electricity: Coproduced.
- Coal: Normal input.
- Biomass: Normal input.
- Steam: Normal usage.
- 
- 

# Energy Production Cycle 

Soda Ash BOM:

 

<!-- image6.png read by Qwen3-VL (local vision model) -->

# Display material BOM: General Item Overview

| Material | 518 | SODA ASH |
| --- | --- | --- |
| Plant | OC01 | Chemical - Plant (Mfg US) |
| Alternative BOM | 1 |  |

**Position** **Effectivity Initial Screen**

| Material | Document | General |
| --- | --- | --- |

| Item | ICT | Component | Component description | Quantity | U... | A... | SIs | Valid From | Valid to |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0010 | L | 514 | LIME | 2 | KG |  |  | 28.07.2025 | 31.12.9999 |
| 0020 | L | 515 | SALT | 1 | KG |  |  | 28.07.2025 | 31.12.9999 |
| 0030 | L | 520 | STEAM BY-PROD | 2- | KGS |  |  | 28.07.2025 | 31.12.9999 |

# Energy Production Cycle 

Energy BOM in SAP

Alternative BOM 1: 

<!-- image7.png read by Qwen3-VL (local vision model) -->

# Display material BOM: General Item Overview

| Material | 521 | STEAM CO-PRODUCT |
| --- | --- | --- |
| Plant | OC01 | Chemical - Plant (Mfg US) |
| Alternative BOM | 1 |  |

**Position** **Effectivity Initial Screen**

| Material | Document | General |
| --- | --- | --- |

| Item | Ict | Component | Component description | Quantity | UoM | A... | SIs | Valid From | Valid to |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0010 | L | 90000211 | ELECTRICITY | 1- | KWM |  |  | 28.07.2025 | 31.12.9999 |
| 0020 | L | 512 | PET COKE | 2 | KG |  |  | 28.07.2025 | 31.12.9999 |
| 0030 | L | 520 | STEAM BY-PROD | 1 | KGS |  |  | 28.07.2025 | 31.12.9999 |
| 0040 | N | 18000020 | GAS | 1 | KG |  |  | 28.07.2025 | 31.12.9999 |

# Energy Production Cycle 

Energy BOM in SAP

Alternative BOM 2:

 

<!-- image8.png read by Qwen3-VL (local vision model) -->

# Display material BOM: General Item Overview

| Material | 521 | STEAM CO-PRODUCT |
| --- | --- | --- |
| Plant | OC01 Chemical - Plant (Mfg US) |  |
| Alternative BOM | 2 |  |

**Position** **Effectivity Initial Screen**

**Material** **Document** **General**

| Item | ICT | Component | Component description | Quantity | UoM | A... | SIs | Valid From | Valid to | Chan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0010 | L | 90000211 | ELECTRICITY | 1- | KWM |  |  | 28.07.2025 | 31.12.9999 |  |
| 0020 | L | 511 | COAL | 1 | KG |  |  | 28.07.2025 | 31.12.9999 |  |
| 0030 | L | 513 | BIO MASS | 2 | KG |  |  | 28.07.2025 | 31.12.9999 |  |
| 0040 | L | 520 | STEAM BY-PROD | 2 | KGS |  |  | 28.07.2025 | 31.12.9999 |  |

# Energy Production Cycle 

Soda Ash Process Order :

 

<!-- image9.png read by Qwen3-VL (local vision model) -->

# Create Process Order: Header - General Data

| Process Order | %0000000001 |
| --- | --- |
| Material | 518 |
| System Status | REL BASC BCRQ MACM ORRQ SETC |
| Type | YBM2 |
| Plant | OC01 |

## General Data

### Quantities

| Field | Value | Unit |
| --- | --- | --- |
| Total Qty | 2 | KG |
| Scrap |  | 0.00% |
| Delivered | 0 |  |

### Dates/Times

| Field | Basic Dates | Scheduled | Confirmed |
| --- | --- | --- | --- |
| End | 29.08.2025 24:00:00 | 29.08.2025 00:00:00 |  |
| Start | 29.08.2025 00:00:00 | 29.08.2025 00:00:00 | 00:00:00 |
| Release |  | 29.08.2025 | 29.08.2025 |

### Scheduling

| Field | Value |
| --- | --- |
| Type | Current date |
| Reduction | No reduction carried out |

### Floats

| Field | Value |
| --- | --- |
| Sched. Margin Key |  |
| Float before prod. | Workdays |

✅ Release carried out

# Energy Production Cycle 

Auto Batch Determination for components :

 

<!-- image10.png read by Qwen3-VL (local vision model) -->

# Create Process Order: Material List

| Process Order | %0000000001 |
| --- | --- |
| Material | 518 |
|  | SODA ASH |
| Type | YBM2 |
| Plant | OC01 |

## Material List

| Item | Material | Material Description | L... | Requirement Quant... | U... | It... | R... | Sto... | Req. Segm... | Sto... | Batch | Co-... | Ba... | Bul... | P... |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0010 | 514 | LIME |  |  | KG | L | X | OCST |  |  | 0000001055 |  |  |  |  |
| 0010 | 514 | LIME |  | 4 | KG | L | X | OCST |  |  | 0000001055 |  |  |  |  |
| 0020 | 515 | SALT |  |  | KG | L | X | OCST |  |  | 0000001057 |  |  |  |  |
| 0020 | 515 | SALT |  | 2 | KG | L | X | OCST |  |  | 0000001057 |  |  |  |  |
| 0030 | 520 | STEAM BY-PROD |  | 4- | KGS | L | X | OCST |  |  |  |  |  |  |  |
| 0040 |  |  |  |  |  |  | X |  |  |  |  |  |  |  |  |
| 0050 |  |  |  |  |  |  | X |  |  |  |  |  |  |  |  |
| 0060 |  |  |  |  |  |  | X |  |  |  |  |  |  |  |  |

# Energy Production Cycle 

Final Confirmation of Order :

 

<!-- image11.png read by Qwen3-VL (local vision model) -->

# Process Order Confirmation Enter : Actual Data

## Goods Movements

| Process Order | 1001176 | Order Type | YBM2 | MRP Controller | Plant | OC01 |
|---------------|---------|------------|------|----------------|-------|------|
| Material      | 518     |            |      |                |       |      |
| Material Descr. | SODA ASH |            |      |                |       |      |
| System Status | REL PRT PRC BASC BCRQ MACM ORRQ SETC |            |      |                |       |      |

## Confirmation Type

- Partial Confirm.
- Final Confirm.
- Aut. Final Conf.
- Clear Reservation

## Actual Data

| Yield t/b Conf. | Current to Confirm | Unit | Already Confirmed | Planned t/b Conf. | Unit |
|------------------|--------------------|------|-------------------|-------------------|------|
| 2                |                    | KG   | 0                 | 2                 | KG   |
| Confirmed Scrap |                    |      | 0                 | 0                 |      |
| Reason for Var. |                    |      |                   |                   |      |
| Personnel no.    |                    |      |                   |                   |      |

| Start Execution | 29.08.2025 | 01:47:24 | Already Confirmed | Planned t/b Conf. |
|------------------|------------|-----------|-------------------|-------------------|
| Finish Execut.   | 29.08.2025 | 01:47:24 |                   | 29.08.2025        |
| Posting Date     | 29.08.2025 |           |                   | 29.08.2025        |

# Energy Production Cycle 

Auto Goods Movement for Consumption :

 

<!-- OCR of image12.png via tesseract, mean confidence 85.2 -->

Confirmation of Process Order Enter : Goods Movernents

Process Order

1001176

Status

REL PRT PRC BASC BCRQ MACM ORRQ SETC

Material

518

SODA ASH

ead bed EE ES) Goods Movements Overview

Batch Determination

Stock Determination

|

Entry

Material

Quantity

U... Plant Loc... Req. Segm.. Stock Segment Batch 4KG OCO0O1 OCST 0000001055

Valuation T... D... M... S.. Sup

514

H

261

515

2KG OCO0O1 OCST

0000001057

261

520

4KGS OCO1 OCST

H

531

4 +b

# Energy Production Cycle 

Goods Movement posted for Consumption :

Steam is produced as By-product with movement type 531

 

<!-- image13.png read by Qwen3-VL (local vision model) -->

| Order | Mater... | Goods mvmt | GR Non-... | Mat. Doc. | It... | Movmt Ty... | Location | Batch | D/C Ind... | LC Amou... | Curren... |
|:------|:---------|:------------|:-----------|:----------|:------|:------------|:---------|:------|:-----------|:-----------|:----------|
| 1001176 | 514 | 1 |  | 4900003111 | 1 | 261 | OCST | 0000001055 | H | 40.00 | USD |
|  | 515 |  |  | 4900003111 | 2 | 261 | OCST | 0000001057 | H | 20.00 | USD |
|  | 520 |  |  | 4900003111 | 3 | 531 | OCST | 0000001123 | S | 40.0- | USD |

# Energy Production Cycle 

Goods Receipt Posted:

 

<!-- image14.png read by Qwen3-VL (local vision model) -->

| Order | Mater... | Goods mv... | GR Non-... | Mat. Doc. | It... | Movmt Ty... | Location | Batch | D/C Ind... | LC Amou... | Curren... |
|:------|:---------|:------------|:-----------|:----------|:------|:------------|:---------|:------|:-----------|:-----------|:----------|
| 1001176 | 514 | 1 |  | 4900003111 | 1 | 261 | OCST | 0000001055 | H | 40.00 | USD |
|  | 515 |  |  | 4900003111 | 2 | 261 | OCST | 0000001057 | H | 20.00 | USD |
|  | 520 |  |  | 4900003111 | 3 | 531 | OCST | 0000001123 | S | 40.00- | USD |
|  | 518 | 4 |  | 5000001701 | 1 | 101 | OCST | 0000001122 | S | 20.00- | USD |

# Energy Production Cycle 

Process order for Energy:

 

<!-- image15.png read by Qwen3-VL (local vision model) -->

# Create Process Order: Header - General Data

| Process Order | %0000000001 | Multiple Items | Type | YBM2 |
|---------------|--------------|----------------|------|------|
| Material | 521 | STEAM CO-PRODUCT | Plant | OC01 |
| System Status | REL BASC BCRQ MACM ORRQ SETC SETM | | | |

## General Data

### Quantities

| Field | Value | Unit | Field | Value |
|-------|-------|------|-------|-------|
| Total Qty | 2 | KGS | Short/Exc. Rec. | 0 |
| Scrap | | 0.00% | | |
| Delivered | 0 | | | |

### Dates/Times

| Field | Basic Dates | Scheduled | Confirmed |
|-------|-------------|-----------|-----------|
| End | 29.08.2025 24:00:00 | 29.08.2025 00:00:00 | |
| Start | 29.08.2025 00:00:00 | 29.08.2025 00:00:00 | 00:00:00 |
| Release | | 29.08.2025 | 29.08.2025 |

### Scheduling

| Field | Value |
|-------|-------|
| Type | Current date |
| Reduction | No reduction carried out |

### Floats

| Field | Value |
|-------|-------|
| Sched. Margin Key | |
| Float before prod. | Workdays |

✅ Release carried out

# Energy Production Cycle 

Batch determination of components:

 

<!-- image16.png read by Qwen3-VL (local vision model) -->

# Create Process Order: Material List

| Process Order | %0000000001 |
| --- | --- |
| Material | 521 |
|  | STEAM CO-PRODUCT |
| Type | YBM2 |
| Plant | OC01 |

## Material List

| Item | Material | Material Description | L... | Requirement Quant... | U... | It... | R... | Sto... | R S... | Batch | Co-product | Backflushing | Bul... |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0000 | 521 | STEAM CO-PRODUCT |  | 2-KGS | L |  |  | OCST |  | 0000001140 | ✓ | ✓ |  |
| 0010 | 90000211 | ELECTRICITY |  | 2-KW... | L |  |  | OCST |  | 0000001141 | ✓ | ✓ |  |
| 0020 | 512 | PET COKE |  |  | KG | L | X | OCST |  |  |  | ✓ |  |
| 0020 | 512 | PET COKE |  | 4 | KG | L | X | OCST |  | 0000001062 |  | ✓ |  |
| 0030 | 520 | STEAM BY-PROD |  |  | KGS | L | X | OCST |  |  |  | ✓ |  |
| 0030 | 520 | STEAM BY-PROD |  | 2 | KGS | L | X | OCST |  | 0000001059 |  | ✓ |  |
| 0040 | 18000020 | GAS |  | 2 | KG | N | X |  |  |  |  | ✓ |  |
| 0050 |  |  |  |  |  |  | X |  |  |  |  |  |  |
| 0060 |  |  |  |  |  |  | X |  |  |  |  |  |  |
| 0070 |  |  |  |  |  |  | X |  |  |  |  |  |  |

# Energy Production Cycle 

Final Confirmation of process order:

 

<!-- image17.png read by Qwen3-VL (local vision model) -->

# Process Order Confirmation Enter : Actual Data

## Goods Movements

| Process Order | 1001184 | Order Type | YBM2 | MRP Controller | Plant | OC01 |
|---------------|----------|------------|------|----------------|--------|------|
| Material      | 521      |            |      |                |        |      |
| Material Descr. | STEAM CO-PRODUCT |            |      |                |        |      |
| System Status | REL PRT PRC CSER BASC BCRQ MACM ORRQ* |            |      |                |        |      |
| Reversed      |          |            |      |                |        | ☐    |

## Confirmation Type

- Partial Confirm.
- Final Confirm.
- Aut. Final Conf. ✅
- Clear Reservation ✅

## Actual Data

| Yield t/b Conf. | Current to Confirm | Unit | Already Confirmed | Planned t/b Conf. | Unit |
|------------------|--------------------|------|-------------------|--------------------|------|
| 2                |                    | KGS  | 0                 | 2                  | KGS  |
| Confirmed Scrap  |                    |      | 0                 | 0                  |      |
| Reason for Var.  |                    |      |                   |                    |      |
| Personnel no.    |                    |      |                   |                    |      |

## Execution Dates

|                | To Be Confirmed       | Already Confirmed | Planned t/b Conf. |
|----------------|-----------------------|-------------------|-------------------|
| Start Execution | 29.08.2025 05:24:35   |                   | 29.08.2025        |
| Finish Execut.  | 29.08.2025 05:24:35   |                   | 29.08.2025        |
| Posting Date    | 29.08.2025            |                   |                   |

# Energy Production Cycle 

Auto Goods movement (GR/GI) taking place at the time of Confirmation:

 

<!-- image18.png read by Qwen3-VL (local vision model) -->

# Confirmation of Process Order Enter : Goods Movements

| Process Order | 1001184 | Status | REL | PRT | PRC | CSER | BASC | BCRQ | MACM | ORRQ* |
|---------------|---------|--------|-----|-----|-----|------|------|------|------|-------|
| Material      | 521     |        |     |     |     |      |      |      |      |       |
|               |         |        |     |     |     |      |      |      |      | STEAM CO-PRODUCT |

| Batch Determination | Stock Determination | Entry |
|---------------------|---------------------|-------|

## Goods Movements Overview

| Material | Quantity | Unit of Entry | Plant | Loc... | Req.... | S. | Batch | Valuation T... | D... | M... | S.. | Supplier | Cu... |
|-----------|-----------|---------------|-------|--------|---------|----|--------|----------------|-------|-------|-----|----------|--------|
| 521       | 2         | KGS           | OC01  | OCST   |         |    | 0000001140 |                | S     | 101   |     |          |        |
| 90000211  | 2         | KWM           | OC01  | OCST   |         |    | 0000001141 |                | S     | 101   |     |          |        |
| 18000020  | 2         | KG            | OC01  |        |         |    |            |                | H     | 261   | P    |          |        |
| 512       | 4         | KG            | OC01  | OCST   |         |    | 0000001062 |                | H     | 261   |     |          |        |
| 520       | 2         | KGS           | OC01  | OCST   |         |    | 0000001059 |                | H     | 261   |     |          |        |

# Energy Production Cycle 

Auto Goods movement (GR/GI) posted for process order:

 

<!-- image19.png read by Qwen3-VL (local vision model) -->

| Order | Material | Goods mv... | GR Non-... | Mat. Doc. | It... | Movmt Ty... | Location | Batch | D/C Ind... | LC Amou... | Curren... |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1001184 | 512 | 1 |  | 4900003117 | 4 | 261 | OCST | 0000001062 | H | 40.00 | USD |
|  | 520 |  |  | 4900003117 | 5 | 261 | OCST | 0000001059 | H | 20.00 | USD |
|  | 18000020 |  |  | 4900003117 | 3 | 261 |  |  | H | 10.00 | USD |
|  | 521 | 4 |  | 4900003117 | 1 | 101 | OCST | 0000001140 | S | 20.00- | USD |
|  | 90000211 |  |  | 4900003117 | 2 | 101 | OCST | 0000001141 | S | 20.00- | USD |

# Thank you

<!-- no readable text in image2.jpg (OCR confidence 45.3) -->