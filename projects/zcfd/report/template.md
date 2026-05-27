
## Introduction


## Geometry


### Axis Convention
The axis convention and origin used in this analysis is the same as the original CAD to facilitate and read across to the original model. The analysis was performed in $m$ to ensure the output is dimensional without requiring scaling. This is referenced as the body axis in this document.

- **Port:** x axis
- **Up:** y axis
- **Forward:** z axis

### Weight and CG
+-------------+------------------------------+
| Property    | Value                        |
+=============+==============================+
| CG          |  [0.0, 0.0, 0.0]             |
+-------------+------------------------------+
| Weight      |  50kg                        |
+-------------+------------------------------+

### Flight Angle Definition

Alpha and beta angle definition

+--------------------------------------------------+--------------------------------------------------+
| ![](images/alpha_diagram.png){ width=75% }       | ![](images/beta_diagram.png){ width=75% }        |
+--------------------------------------------------+--------------------------------------------------+

> **Note:**
> The p (z-axis), q (x-axis) and r (y-axis) rates are applied around the body axes acting through the cg. +ve rates are right hand rule about each axis.

The transformation from body axis to wind axis is given by:

| Wind Axis Component | Transformation Equation |
|---------------------|------------------------|
| $V_{wz}$ | $V_{wz} = -\sin(\beta)V_x - \sin(\alpha)\cos(\beta)V_y + \cos(\alpha)\cos(\beta)V_z$ |
| $V_{wx}$ | $V_{wx} =  \cos(\beta)V_x - \sin(\alpha)\sin(\beta)V_y + \cos(\alpha)\sin(\beta)V_z$ |
| $V_{wy}$ | $V_{wy} = \cos(\alpha)V_y + \sin(\alpha)V_z$ |



## Model Setup

### Mesh Generation

The mesh was generated using Ansys Fluent Meshing v25r2. We generated several different meshes on increasing resolution to ensure that the mesh we used for the final analysis was minimally influenced by the mesh resolution. 

![Meshing](images/mesh.png){ width=90% } 


### Force/Moment reporting
The force and moments are reported in dimensional units using body axes. 
The moments all use the cg location as the moment reference point and all non dimensional forces and moments in coefficient form use the transformation to wind axis but using the standard aerodynamic convention of +ve lift upwards, +ve drag rearwards and +ve pitching moment nose up.


## Performance Analysis

The analysis conditions are defined in Test_Points_v1.tsv. 

+--------------+----------------+
| Constant     | Value          |
+==============+================+
| $S_{ref}$    | 1.96$m^2$      |
+--------------+----------------+
| $L_{chord}$  | 1.470m         |
+--------------+----------------+
| $L_{span}$   | 2.34m          |
+--------------+----------------+


\clearpage
## Appendix

### Results csv column descriptions

+-----------------------------+---------------------------------------------------------------------+
| Column Name                 | Description                                                         |
+=============================+=====================================================================+
| Run ID                      | Run id as per spreadsheet                                           |
+-----------------------------+---------------------------------------------------------------------+
| Airspeed [m/s]              | Flight speed in m/s                                                 |
+-----------------------------+---------------------------------------------------------------------+
| Angle of Attack [°]         | Angle of attack $\alpha$                                            |
+-----------------------------+---------------------------------------------------------------------+
| Angle of Sideslip [°]       | Angle of sideslip $\beta$                                           |
+-----------------------------+---------------------------------------------------------------------+
| p [°/s]                     | Roll rate around z-axis of cg                                       |
+-----------------------------+---------------------------------------------------------------------+
| q [°/s]                     | Pitch rate around x-axis of cg                                      |
+-----------------------------+---------------------------------------------------------------------+
| r [°/s]                     | Yaw rate around y-axis of cg                                        |
+-----------------------------+---------------------------------------------------------------------+
| Half-Body or Full Body run  | Half or Full body mesh                                              |
+-----------------------------+---------------------------------------------------------------------+
| Comment                     | Comment from spreadsheet                                            |
+-----------------------------+---------------------------------------------------------------------+
| Fx [N]                      | Body axis pressure + friction force in N                            |
+-----------------------------+---------------------------------------------------------------------+
| Fy [N]                      | Body axis pressure + friction force in N                            |
+-----------------------------+---------------------------------------------------------------------+
| Fz [N]                      | Body axis pressure + friction force in N                            |
+-----------------------------+---------------------------------------------------------------------+
| Mx [Nm]                     | Body axis pressure + friction moment in Nm                          |
+-----------------------------+---------------------------------------------------------------------+
| My [Nm]                     | Body axis pressure + friction moment in Nm                          |
+-----------------------------+---------------------------------------------------------------------+
| Mz [Nm]                     | Body axis pressure + friction moment in Nm                          |
+-----------------------------+---------------------------------------------------------------------+
| C_L                         | Wind axis force $\frac{F^t_y}{0.5 \rho\ V^2 S_{ref}}$               |
+-----------------------------+---------------------------------------------------------------------+
| C_D                         | Wind axis force $\frac{F^t_z}{0.5 \rho\ V^2 S_{ref}}$               |
+-----------------------------+---------------------------------------------------------------------+
| C_S                         | Wind axis force $\frac{F^t_x}{0.5 \rho\ V^2 S_{ref}}$               |
+-----------------------------+---------------------------------------------------------------------+
| C_m                         | Wind axis moment $\frac{M^t_x}{0.5 \rho\ V^2 S_{ref} L_{chord}}$    |
+-----------------------------+---------------------------------------------------------------------+
| C_n                         | Wind axis moment $\frac{M^t_y}{0.5 \rho\ V^2 S_{ref} L_{span}}$     |
+-----------------------------+---------------------------------------------------------------------+
| C_l                         | Wind axis moment $\frac{M^t_z}{0.5 \rho\ V^2 S_{ref} L_{span}}$     |
+-----------------------------+---------------------------------------------------------------------+

\clearpage