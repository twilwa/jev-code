import Base

law add2:
  for a: U32
  for b: U32
  U32

def add2(a, b):
  U32.add(a, b)

law main:
  U32

def main(): add2(2, 3)
