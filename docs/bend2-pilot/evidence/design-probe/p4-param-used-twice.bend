import Base

law dbl:
  for a: U32
  U32

def dbl(a):
  U32.add(a, a)

law main:
  U32

def main(): dbl(21)
