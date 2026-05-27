import sys
try:
    from paraview.simple import *
    import paraview.servermanager as sm
    pm = sm.vtkProcessModule.GetProcessModule()
    if pm:
        print(f"Partition: {pm.GetPartitionId()}")
        print(f"Num Partitions: {pm.GetNumberOfLocalPartitions()}")
except Exception as e:
    print(e)
