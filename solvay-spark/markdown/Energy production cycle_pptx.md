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

<!-- tables in image5.png read by image processing + tesseract -->

Component4 Steam

Normal

| yoo - - - - - I I |  |  |  |  | — ee oe ee ee ee ee ee ee |  |
|---|---|---|---|---|---|---|
| iENERGY |  |  |  | Normal Product |  |  |
| BOM 1 Header | Steam | Coproduct |  | BOM 1 Header | Soda Ask |  |
| iComponent 1 | Electricity | Coproduct |  | Lime | Normal |  |
| iComponent 2 | Pet Coke | Normal |  | Other raw material | Normal |  |
| Namnanent 2 | Steam | Narmal wu. |  | Steam | Runradin | “ft |
| ihetiiediiiltel pelitedidteltedididiadlied |  |  |  |  |  |  |
| Component 4 | Gas | Pipeline |  |  |  |  |
|  |  |  | BOILER 1-WC 1 |  |  |  |
| IBOM 2 Header | Steam | Coproduct |  |  |  |  |
| iComponent 1 | Electricity | Coproduct |  |  |  |  |
| Component 2 | Coal | Normal |  |  |  |  |
| iComponent 3 | Biomass | Normal |  |  |  |  |

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

 

<!-- tables in image6.png read by image processing + tesseract -->

Display material BOM: General Item Overview Ee

&

_ New Entries

|i | Header Details P Validity Co

Document

General

- Material

| Material | 518 G SODAASH |
|---|---|
| Plant | OCO1 Chemical - Plant (Mfg US) |
| Alternative BOM |  |
| Position | Effectivity Initial Screen |

| Item |  | Component | Component description | Quantity |  | SIs | Valid From | Valid to |
|---|---|---|---|---|---|---|---|---|
| 0010 | L | 514 | LIME | 2 | KG |  | 28.07.2025 | 31.12.9999 |
| 0020 | L | 515 | SALT | 1 | KG |  | 28.07.2025 | 31.12.9999 |
| 0030 | L | 520 | STEAM BY-PROD |  | KGS |  | 28.07.2025 | 31.12.9999 |

# Energy Production Cycle 

Energy BOM in SAP

Alternative BOM 1: 

<!-- tables in image7.png read by image processing + tesseract -->

Display material BOM: General Item Overview

&

P Validity

Viaterial lant \lternative BOM 1 Position | Effectivity Initial Screen _/ Material {Document | General

{521 OCO1 Chemical - Plant (Mfg US)

i STEAM CO-PRODUCT

| Item |  | Component | Component description | Quantity | UoM | SIs | Valid From | Valid to |
|---|---|---|---|---|---|---|---|---|
| 0010 | L | 90000211 | ELECTRICITY |  | KWM |  | 28.07.2025 | 31.12.9995 |
| 0020 | L | 512 | PET COKE | 2 | KG |  | 28.07.2025 | 31.12.9995 |
| 0030 | L | 520 | STEAM BY-PROD | 1 | KGS |  | 28.07.2025 | 31.12.9995 |
| 0040 | N | 18000020 | GAS | 1 | KG |  | 28.07.2025 | 31.12.9995 |

# Energy Production Cycle 

Energy BOM in SAP

Alternative BOM 2:

 

<!-- tables in image8.png read by image processing + tesseract -->

Display material BOM: General Item Overview ER &)

&

P Validity

| |

}

- Material —

Document

General

| Viaterial | 521 STEAM CO-PRODUCT |
|---|---|
| lant | OCO1 Chemical - Plant (Mfg US) |
| \lternative BOM |  |
| Position | Effectivity Initial Screen |

| Item |  | Component | Component description | Quantity | UoM | SIs | Valid From | Valid to | Char |
|---|---|---|---|---|---|---|---|---|---|
| 0010 | L | 90000211 | ELECTRICITY |  | KWM |  | 28.07.2025 | 31.12.9999 |  |
| 0020 | L | Sli | COAL | 1 | KG |  | 28.07.2025 | 31.12.9999 |  |
| 0030 | L | S13 | BIO MASS | 2 | KG |  | 28.07.2025 | 31.12.9999 |  |
| 0040 | L | 520 | STEAM BY-PROD | 2 | KGS |  | 28.07.2025 | 31.12.9999 |  |

# Energy Production Cycle 

Soda Ash Process Order :

 

<!-- tables in image9.png read by image processing + tesseract -->

Create Process Order: Header - General Data

alt] | Sp

“aCapacity {= WM Material Staging

= = Operations

=>, Material List

XSteps

|

Process Order

Material

518

SODA ASH i)

System Status

REL BASC BCRQ MACM ORRQ SETC

General Data

Assignment

—§ Goods Receipt

= Control

Dates/Quantities

Master Data

Administr.

Items

SAP Event Mgmt

Quantities

Total Qty Scrap Delivered

2

KG

Short/Exc. Rec.

0

0.00

c °

Dates/Times

Basic Dates

Scheduled

Ed 00:00:00

Confirmed

24:00:00

29.08.2025

00:00:00

00:00:00

29.08.2025

Scheduling

Floats

Type Reduction

Current date

Sched. Margin Key Float before prod.

No reduction carried out

Workdays

Release carried out

| Type | YBM2 |
|---|---|
| Plant | Ocol |

| End | 29.08.2025 |
|---|---|
| Start | 29.08.2025 |

| Start 29.08.2025 00:00:00 | 29.08.2025 |
|---|---|
| Release | 29.08.2025 |

# Energy Production Cycle 

Auto Batch Determination for components :

 

<!-- tables in image10.png read by image processing + tesseract -->

Create Process Order: Material List

Material Staging

©, © Operations

> Material List

ras

Process Order

300000000001

“SODA ASH

Material

518

(258)

Batch | (Lt) il

Material List

Entry

1

of

5

al

| Type | YBM2 |
|---|---|
| Plant | Ocol |

| Item | Material | Material Description | Requirement Quant... |  | It... |  | Sto... | Req. Segm... | Sto... | Batch | Co-... | Ba... | Bul... | P. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0010 | 514 | LIME |  | KG | L | X | OCST |  |  |  |  |  |  |  |
| 0010 | 514 | LIME | 4 | KG | L | X | OCST |  |  | 0000001055 |  |  |  |  |
| 0020 | 515 | SALT |  | KG | L | X | OCST |  |  |  |  |  |  |  |
| 0020 | 515 | SALT | 2 | KG | L | X | OCST |  |  | 0000001057 |  |  |  |  |
| 0030 | 520 | STEAM BY-PROD | 4- | KGS | L | X | OCST |  |  |  |  |  |  |  |
| 0040 |  |  |  |  |  | X |  |  |  |  |  |  |  |  |
| 0050 |  |  |  |  |  | X |  |  |  |  |  |  |  |  |

# Energy Production Cycle 

Final Confirmation of Order :

 

<!-- tables in image11.png read by image processing + tesseract -->

Process Order Confirmation Enter : Actual Data

Movements

Process Order

1001176

Order Type

MRP Controller

Plant

ocol

System Status

REL PRT PRC BASC BCRQ MACM ORRQ SETC

e\/a

Confirmation Type

Partial Confirm.

Final Confirm.

e Aut. Final Conf.

Clear Reservation

Actual Data

Current to Confirm

Unit Already Confirmed 0

Planned t/b Conf.

Unit

2

KG

0

0

Personnel no.

To Be Confirmed

Already Confirmed

Planned t/b Conf.

29.08.2025

29.08.2025

| Material | 518 |
|---|---|
| Material Descr. | SODA ASH |

| Yield t/b Conf. | 2 Kc |
|---|---|
| Confirmed Scrap |  |
| Reason for Var. |  |

| Start Execution | 29.08.2025 | 01:47:24 |
|---|---|---|
| Finish Execut. | 29.08.2025 | 01:47:24 |
| Posting Date | 29.08.2025 |  |

# Energy Production Cycle 

Auto Goods Movement for Consumption :

 

<!-- tables in image12.png read by image processing + tesseract -->

Confirmation of Process Order Enter : Goods Movements

REL PRT PRC BASC BCRQ MACM ORRQ SETC

SODA ASH

S| PI) [ae

ES)

Batch Determination

Stock Determination

|

Entry

4 +b

| Process Order | 1001176 \| Status |
|---|---|
| Material | 518 |

| Goods Movements Overview |  |  |  |  |  |  |  |  |  |  |  |  |  |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
|  | Material | Quantity |  | Plant | Loc... | Req. Segm... | Stock Segment | Batch | Valuation T... |  |  | S.. | Su |
|  | 514 | 4 | KG | OcOl | OCST |  |  | 0000001055 |  | H | 261 |  |  |
|  | S15 | 2 | KG | Ocol | OCST |  |  | 0000001057 |  | H | 261 |  |  |
|  | 520 | 4 | KGS | Ocol | OCST |  |  |  |  | S | 931 |  |  |

# Energy Production Cycle 

Goods Movement posted for Consumption :

Steam is produced as By-product with movement type 531

 

<!-- tables in image13.png read by image processing + tesseract -->

| Order | Mater... | Goods mvmt | GR Non-... | Mat. Doc. | Ite... | Movmt Ty... | Location | Batch | D/C Ind... | LC Amou... | Curren... |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1001176 | 514 | 1 |  | 4900003111 | 1 | 261 | OCST | 0000001055 | H | 40.00 | USD |
|  | 515 | 1 |  | 4900003111 | 2 | 261 | OCST | 0000001057 | H | 20.00 | USD |
|  | 520 | 1 |  | 4900003111 | 3 | 531 | OCST | 0000001123 | S | 40.00- | USD |

# Energy Production Cycle 

Goods Receipt Posted:

 

<!-- tables in image14.png read by image processing + tesseract -->

Process Order - Documented Goods Movernents

| > |! | lle) (FS |

| Order | Mater... | Goods mv... | GR Non-... | Mat. Doc. | Ite... | Movmt Ty... | Location | Batch | D/C Ind... | LC Amou... | Curren... |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1001176 | 514 | 1 |  | 4900003111 | 1 | 261 | OCST | 0000001055 | H | 40.00 | USD |
| 1001176 | 515 | 1 |  | 4900003111 | 2 | 261 | OCST | 0000001057 | H | 20.00 | USD |
| 1001176 | 520 | 1 |  | 4900003111 | 3 | 531 | OCST | 0000001123 | S | 40.00- | USD |
|  | 518 | 4 |  | 5000001701 | 4 | 101 | OCST | 0000001122 |  | 20.00- | USD |

# Energy Production Cycle 

Process order for Energy:

 

<!-- tables in image15.png read by image processing + tesseract -->

Create Process Order: Header - General Data

&p 34Material

“aCapacity {= WM Material Staging

= = Operations

=>, Material List

XSteps

I A|Multiple an) R _

Process Order

Material

521

STEAM CO-PRODUCT i)

system Status

REL BASC BCRQ MACM ORRQ SETC SETM

General Data

Assignment

—§ Goods Receipt

= Control

Dates/Quantities

Master Data

Administr.

Items

SAP Event Mgmt

Quantities

Total Qty Scrap Delivered

2

KGS

Short/Exc. Rec.

0

0.00

c °

Dates/Times

Basic Dates

Scheduled

Ed 00:00:00

Confirmed

24:00:00

29.08.2025

00:00:00

00:00:00

29.08.2025

Scheduling

Floats

Type Reduction

Current date

Sched. Margin Key Float before prod.

No reduction carried out

Workdays

¥] Release carried out

| Type | YBM2 |
|---|---|
| Plant | Ocol |

| End | 29.08.2025 |
|---|---|
| Start | 29.08.2025 |

| Start 29.08.2025 00:00:00 | 29.08.2025 |
|---|---|
| Release | 29.08.2025 |

# Energy Production Cycle 

Batch determination of components:

 

<!-- tables in image16.png read by image processing + tesseract -->

Create Process Order: Material List

©, © Operations

ras

Material Staging

=, Material List

Order

300000000001 521

STEAM CO-PRODUCT

se) [= |B)

Batch | {Ci lil

Entry

1

of 7

Material List

| Type | YBM2 |
|---|---|
| Plant | Ocol |

| Item | Material | Material Description | Reauirement Quant... |  | It... |  | Sto... | RS.. | Batch | Co-product | Backflushina | Bul.. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0000 | 521 | STEAM CO-PRODUCT |  | KGS | L |  | OCST |  | 0000001140 |  |  |  |
| 0010 | 90000211 | ELECTRICITY |  | KW... | L |  | OCST |  | 0000001141 |  |  |  |
| 0020 | 512 | PET COKE |  | KG | L | X | OCST |  |  |  |  |  |
| 0020 | 512 | PET COKE | 4 | KG | L | X | OCST |  | 0000001062 |  |  |  |
| 0030 | 520 | STEAM BY-PROD |  | KGS | L | X | OCST |  |  |  |  |  |
| 0030 | 520 | STEAM BY-PROD | 2 | KGS | L | X | OCST |  | 0000001059 |  |  |  |
| 0040 | 18000020 | GAS | 2 | KG | N | X |  |  |  |  |  |  |
| 0050 |  |  |  |  |  | X |  |  |  |  |  |  |
| 0060 |  |  |  |  |  | X |  |  |  |  |  |  |
| 0070 |  |  |  |  |  |  |  |  |  |  |  |  |

# Energy Production Cycle 

Final Confirmation of process order:

 

<!-- tables in image17.png read by image processing + tesseract -->

Process Order Confirmation Enter : Actual Data

Movements

Order

1001184

Order Type

YBM2 MRP Controller

Plant

ocol

system Status

REL PRT PRC CSER BASC BCRQ MACM ORRQ*

e\/a

Confirmation Type

Partial Confirm.

Final Confirm.

e Aut. Final Conf.

Clear Reservation

Actual Data

_Current to Confirm

Unit

Already Confirmed 0

Planned t/b Conf.

Unit

2

KGS

0

0

Personnel no.

To Be Confirmed

Already Confirmed

Planned t/b Conf.

29.08.2025

29.08.2025

| laterial | S21 |
|---|---|
| laterial Descr. | STEAM CO-PRODUCT |

| Yield t/b Conf. | e “KGS |
|---|---|
| Confirmed Scrap |  |
| Reason for Var. |  |
| Reason for Var. |  |

| Start Execution | 29.08.2025 | 05:24:35 |
|---|---|---|
| Finish Execut. | 29.08.2025 | 05:24:35 |
| Posting Date | 29.08.2025 |  |

# Energy Production Cycle 

Auto Goods movement (GR/GI) taking place at the time of Confirmation:

 

<!-- tables in image18.png read by image processing + tesseract -->

Confirmation of Process Order Enter : Goods Movements

REL PRT PRC CSER BASC BCRQ MACM ORRQ*

STEAM CO-PRODUCT

| ER | ER | | Goods Movements Overview

lat |

Batch Determination

Stock Determination

Entry

|

4 +b

| ocess Order | 1001184 \| Status |
|---|---|
| aterial | S21 |

| Material | Quantity | Unit of Entry | Plant | Loc... | Req.... | S.. | Batch | Valuation T... |  |  | S.. | Supplier | Ci |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S21 | 2 | KGS | Ocol | OCST |  |  | 0000001140 |  | S | 101 |  |  |  |
| 90000211 | 2 | KWM | Ocol | OCST |  |  | 0000001141 |  | S | 101 |  |  |  |
| 18000020 | 2 | KG | Ocol |  |  |  |  |  |  | 261 | P |  |  |
| S12 | 4 | KG | OcOl | OCST |  |  | 0000001062 |  |  | 261 |  |  |  |
| 520 | 2 | KGS | Ocol | OCST |  |  | 0000001059 |  |  | 261 |  |  |  |

# Energy Production Cycle 

Auto Goods movement (GR/GI) posted for process order:

 

<!-- tables in image19.png read by image processing + tesseract -->

| 4 Pr | ocess Oj | der - De | ICUITIC | ited Goi |  | > Mover | nents |  |  |  |  |
|---|---|---|---|---|---|---|---|---|---|---|---|
| m \| ell |  |  |  |  |  |  |  |  |  |  |  |
| Order | Material | Goods mv... | GR Non-... | Mat. Doc. | Ite... | Movmt Ty... | Location | Batch | D/C Ind... | LC Amou... | Curren... |
| 1001184 | 512 | 1 |  | 4900003117 | 4 | 261 | OCST | 0000001062 | H | 40.00 | USD |
|  | 520 | 1 |  | 4900003117 | 5 | 261 | OCST | 0000001059 | H | 20.00 | USD |
|  | 18000020 | 1 |  | 4900003117 | 3 | 261 |  |  | H | 10.00 | USD |
|  | 521 | 4 |  | 4900003117 | 1 | 101 | OCST | 0000001140 | S | 20.00- | USD |
|  | 90000211 |  |  | 4900003117 | 2 | 101 | OCST | 0000001141 | S | 20.00- | USD |

# Thank you

<!-- no readable text in image2.jpg (OCR confidence 45.3) -->